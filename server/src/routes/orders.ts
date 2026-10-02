import type { FastifyPluginAsync } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { HttpError, requireAuth, currentProfile } from '../middleware/auth.js';
import { OrderCreateSchema } from '../schemas.js';
import { notifyAdminsOfOrder } from '../bot.js';
import type { Order, OrderItem, Product, StoreSettings } from '../types.js';

const RATE_LIMIT_PER_HOUR = 5;
const ORDER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function genOrderCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += ORDER_CODE_ALPHABET[Math.floor(Math.random() * ORDER_CODE_ALPHABET.length)];
  }
  return `MD-${s}`;
}

function buildPaymentUrl(
  settings: StoreSettings | null,
  orderCode: string,
  total: number,
): string | null {
  if (!settings) return null;
  const sym = settings.currency_symbol;
  const totalStr = total % 1 === 0 ? total.toString() : total.toFixed(2);

  if (settings.payment_provider === 'stripe_link' && settings.payment_url) {
    const sep = settings.payment_url.includes('?') ? '&' : '?';
    return `${settings.payment_url}${sep}client_reference_id=${encodeURIComponent(orderCode)}`;
  }
  if (settings.payment_provider === 'ton' && settings.payment_ton_address) {
    // Amount is expressed in nanoTON. Assumes the store prices in TON —
    // see README section on payments.
    return `ton://transfer/${settings.payment_ton_address}?amount=${Math.round(total * 1e9)}&text=${encodeURIComponent(orderCode)}`;
  }
  if (settings.payment_provider === 'custom' && settings.payment_url) {
    const sep = settings.payment_url.includes('?') ? '&' : '?';
    return `${settings.payment_url}${sep}order=${encodeURIComponent(orderCode)}&amount=${encodeURIComponent(totalStr + sym)}`;
  }
  return null;
}

export const orderRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/orders/mine', { preHandler: requireAuth }, async (req, reply) => {
    const me = currentProfile(req);
    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('user_id', me.id)
      .order('created_at', { ascending: false });
    if (error) throw new HttpError(500, error.message);

    const ids = (orders as Order[] | null)?.map((o) => o.id) ?? [];
    const { data: items } = ids.length
      ? await supabaseAdmin.from('order_items').select('*').in('order_id', ids)
      : { data: [] as OrderItem[] };

    return reply.send({
      orders: (orders as Order[]) ?? [],
      items: (items as OrderItem[]) ?? [],
    });
  });

  app.post('/api/orders', { preHandler: requireAuth }, async (req, reply) => {
    const me = currentProfile(req);
    const body = OrderCreateSchema.parse(req.body);

    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { count: recentCount, error: rlErr } = await supabaseAdmin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', me.id)
      .gte('created_at', oneHourAgo);
    if (rlErr) throw new HttpError(500, rlErr.message);
    if ((recentCount ?? 0) >= RATE_LIMIT_PER_HOUR) {
      throw new HttpError(429, 'Too many orders. Try again in a bit.');
    }

    const productIds = [...new Set(body.items.map((i) => i.product_id))];
    const { data: productsRaw, error: pErr } = await supabaseAdmin
      .from('products')
      .select('*')
      .in('id', productIds);
    if (pErr) throw new HttpError(500, pErr.message);
    const products = (productsRaw as Product[]) ?? [];

    const byId = new Map(products.map((p) => [p.id, p]));
    for (const line of body.items) {
      const p = byId.get(line.product_id);
      if (!p) throw new HttpError(409, 'A product in your cart no longer exists.');
      if (!p.active) throw new HttpError(409, `"${p.name}" is no longer available.`);
      if (p.stock < line.quantity && p.delivery_type === 'physical') {
        throw new HttpError(409, `Only ${p.stock} of "${p.name}" left in stock.`);
      }
    }

    const { data: settingsRow } = await supabaseAdmin
      .from('store_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    const settings = settingsRow as StoreSettings | null;
    const threshold = settings?.shipping_threshold ?? 60;
    const shipCost = settings?.shipping_cost ?? 6;

    let subtotal = 0;
    for (const line of body.items) {
      const p = byId.get(line.product_id);
      if (!p) continue;
      subtotal += p.price * line.quantity;
    }
    const shipping = subtotal >= threshold ? 0 : shipCost;
    const total = subtotal + shipping;

    let order: Order | null = null;
    for (let attempt = 0; attempt < 3 && !order; attempt++) {
      const code = genOrderCode();
      const { data, error } = await supabaseAdmin
        .from('orders')
        .insert({
          order_code: code,
          user_id: me.id,
          customer_name: body.delivery.name,
          customer_address: body.delivery.address,
          customer_city: body.delivery.city,
          customer_zip: body.delivery.zip || null,
          status: 'Pending payment',
          payment_method: body.payment_method,
          subtotal,
          shipping,
          total,
        })
        .select()
        .single();
      if (error?.code === '23505') continue;
      if (error || !data) throw new HttpError(500, error?.message ?? 'order insert failed');
      order = data as Order;
    }
    if (!order) throw new HttpError(500, 'Could not generate a unique order code');

    const itemRows = body.items.map((line) => {
      const p = byId.get(line.product_id)!;
      return {
        order_id: order!.id,
        product_id: p.id,
        product_name: p.name,
        product_price: p.price,
        quantity: line.quantity,
        pastel_color: p.pastel_color,
      };
    });
    const { error: liErr } = await supabaseAdmin.from('order_items').insert(itemRows);
    if (liErr) {
      await supabaseAdmin.from('orders').delete().eq('id', order.id);
      throw new HttpError(500, `order_items failed: ${liErr.message}`);
    }

    for (const line of body.items) {
      const p = byId.get(line.product_id)!;
      if (p.delivery_type !== 'physical') continue;
      const { data: ok, error: decErr } = await supabaseAdmin.rpc('decrement_stock', {
        p_product_id: line.product_id,
        p_qty: line.quantity,
      });
      if (decErr) {
        await supabaseAdmin.from('orders').delete().eq('id', order.id);
        throw new HttpError(500, decErr.message);
      }
      if (!ok) {
        await supabaseAdmin.from('orders').delete().eq('id', order.id);
        throw new HttpError(409, 'Stock changed during checkout. Please retry.');
      }
    }

    // Fire-and-forget, but catch failures so an unhandled rejection does
    // not crash the process. Telegram being briefly down should never
    // affect order creation.
    notifyAdminsOfOrder({
      code: order.order_code,
      customer: order.customer_name,
      city: order.customer_city,
      total: order.total,
    }).catch((err: unknown) => {
      console.error('[orders] admin notify failed:', err);
    });

    const paymentUrl = buildPaymentUrl(settings, order.order_code, order.total);

    console.log(`[order] ${order.order_code} placed by ${me.id} total=${total}`);

    return reply.code(201).send({ order, payment_url: paymentUrl });
  });
};
