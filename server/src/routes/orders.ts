import type { FastifyPluginAsync } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { HttpError, requireAuth, currentProfile } from '../middleware/auth.js';
import { OrderCreateSchema, ProofSubmitSchema } from '../schemas.js';
import { notifyAdminsOfOrder, createStarsInvoiceLink } from '../bot.js';
import { createStripeCheckoutSession } from '../stripe.js';
import type { Order, OrderItem, Product, StoreSettings } from '../types.js';

const RATE_LIMIT_PER_HOUR = 5;
const ORDER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Methods where the admin has real work on a fresh order. Stars and
// Stripe confirm themselves. Manual orders are direct-chat — the buyer
// messages the admin out-of-band, so no notification needed on creation.
const ADMIN_ACTION_METHODS = new Set(['bank', 'crypto', 'cod']);

function genOrderCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += ORDER_CODE_ALPHABET[Math.floor(Math.random() * ORDER_CODE_ALPHABET.length)];
  }
  return `MD-${s}`;
}

type PaymentPayload =
  | { kind: 'none' }
  | { kind: 'stars'; invoice_url: string }
  | { kind: 'stripe'; url: string }
  | { kind: 'bank'; details: string }
  | {
      kind: 'crypto';
      addresses: { btc: string; eth: string; usdt_trc20: string; ton: string };
    }
  | { kind: 'cod' };

function buildPaymentPayload(
  settings: StoreSettings | null,
  method: string,
  starsInvoiceUrl: string | null,
  stripeCheckoutUrl: string | null,
): PaymentPayload {
  if (!settings) return { kind: 'none' };
  if (method === 'stars' && starsInvoiceUrl) return { kind: 'stars', invoice_url: starsInvoiceUrl };
  if (method === 'stripe' && stripeCheckoutUrl) return { kind: 'stripe', url: stripeCheckoutUrl };
  if (method === 'bank') return { kind: 'bank', details: settings.bank_details };
  if (method === 'crypto') {
    return {
      kind: 'crypto',
      addresses: {
        btc: settings.crypto_btc,
        eth: settings.crypto_eth,
        usdt_trc20: settings.crypto_usdt_trc20,
        ton: settings.crypto_ton,
      },
    };
  }
  if (method === 'cod') return { kind: 'cod' };
  return { kind: 'none' };
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

  app.get('/api/orders/:id/downloads', { preHandler: requireAuth }, async (req, reply) => {
    const me = currentProfile(req);
    const { id } = req.params as { id: string };

    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.user_id !== me.id && me.role !== 'admin' && me.role !== 'superadmin') {
      throw new HttpError(403, 'Not your order');
    }
    if (order.status === 'Pending payment' || order.status === 'Cancelled') {
      throw new HttpError(403, 'Order is not paid yet');
    }

    const { data: items } = await supabaseAdmin
      .from('order_items')
      .select('*')
      .eq('order_id', id);
    const rows = (items as OrderItem[]) ?? [];

    const productIds = rows.map((r) => r.product_id).filter((x): x is string => !!x);
    const { data: products } = productIds.length
      ? await supabaseAdmin.from('products').select('*').in('id', productIds)
      : { data: [] as Product[] };
    const byId = new Map(((products as Product[]) ?? []).map((p) => [p.id, p]));

    const downloads: Array<{ product_name: string; signed_url: string }> = [];
    for (const line of rows) {
      if (!line.product_id) continue;
      const p = byId.get(line.product_id);
      if (!p || p.delivery_type !== 'digital' || !p.digital_file_path) continue;

      const { data, error } = await supabaseAdmin.storage
        .from('digital-goods')
        .createSignedUrl(p.digital_file_path, 60 * 60 * 24);
      if (error || !data?.signedUrl) continue;
      downloads.push({ product_name: p.name, signed_url: data.signedUrl });
    }

    return reply.send({ downloads });
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
    let hasPhysical = false;
    for (const line of body.items) {
      const p = byId.get(line.product_id);
      if (!p) throw new HttpError(409, 'A product in your cart no longer exists.');
      if (!p.active) throw new HttpError(409, `"${p.name}" is no longer available.`);
      if (p.stock < line.quantity && p.delivery_type === 'physical') {
        throw new HttpError(409, `Only ${p.stock} of "${p.name}" left in stock.`);
      }
      if (p.delivery_type === 'physical') hasPhysical = true;
    }

    if (hasPhysical && (!body.delivery.address.trim() || !body.delivery.city.trim())) {
      throw new HttpError(400, 'Delivery address is required for physical items.');
    }

    const { data: settingsRow } = await supabaseAdmin
      .from('store_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    const settings = settingsRow as StoreSettings | null;

    const method = body.payment_method;
    const enabled: Record<string, boolean> = {
      stars: !!settings?.stars_enabled,
      stripe: !!settings?.stripe_enabled,
      bank: !!settings?.bank_enabled && !!settings?.bank_details.trim(),
      crypto: !!settings?.crypto_enabled,
      cod: true,
      manual: true,
    };
    if (!enabled[method]) throw new HttpError(400, 'That payment method is not available.');

    const threshold = settings?.shipping_threshold ?? 60;
    const shipCost = settings?.shipping_cost ?? 6;

    let subtotal = 0;
    for (const line of body.items) {
      const p = byId.get(line.product_id);
      if (!p) continue;
      subtotal += p.price * line.quantity;
    }
    const shipping = hasPhysical && subtotal < threshold ? shipCost : 0;
    const total = subtotal + shipping;

    if (method === 'stripe' && total <= 0) {
      throw new HttpError(400, 'Stripe cannot process a $0 order.');
    }

    let order: Order | null = null;
    for (let attempt = 0; attempt < 3 && !order; attempt++) {
      const code = genOrderCode();
      const { data, error } = await supabaseAdmin
        .from('orders')
        .insert({
          order_code: code,
          user_id: me.id,
          customer_name: body.delivery.name,
          customer_address: body.delivery.address || '—',
          customer_city: body.delivery.city || '—',
          customer_zip: body.delivery.zip || null,
          status: 'Pending payment',
          payment_method: method,
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

    let starsInvoiceUrl: string | null = null;
    let stripeCheckoutUrl: string | null = null;

    if (method === 'stars' && settings) {
      const rate = settings.stars_rate > 0 ? settings.stars_rate : 77;
      const starsAmount = Math.max(1, Math.round(total * rate));
      starsInvoiceUrl = await createStarsInvoiceLink({
        title: `Order ${order.order_code}`,
        description: `${body.items.length} item(s) from ${settings.store_name}`,
        payload: `order:${order.id}`,
        starsAmount,
      });
      if (!starsInvoiceUrl) {
        await supabaseAdmin.from('orders').delete().eq('id', order.id);
        throw new HttpError(502, 'Could not create Telegram Stars invoice. Try again.');
      }
      await supabaseAdmin
        .from('orders')
        .update({ payment_redirect_url: starsInvoiceUrl })
        .eq('id', order.id);
    }

    if (method === 'stripe' && settings) {
      try {
        stripeCheckoutUrl = await createStripeCheckoutSession({
          orderCode: order.order_code,
          orderId: order.id,
          lines: body.items.map((line) => {
            const p = byId.get(line.product_id)!;
            return { name: p.name, unit_price: p.price, quantity: line.quantity };
          }),
          shipping,
          currencyCode: settings.currency_code || 'usd',
        });
      } catch (err) {
        await supabaseAdmin.from('orders').delete().eq('id', order.id);
        const msg = err instanceof HttpError ? err.message : 'Stripe session failed.';
        throw new HttpError(502, msg);
      }
      await supabaseAdmin
        .from('orders')
        .update({ payment_redirect_url: stripeCheckoutUrl })
        .eq('id', order.id);
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

    // Only ping admins for methods where they actually have work to do.
    // Stars and Stripe confirm themselves. Manual is direct-chat.
    if (ADMIN_ACTION_METHODS.has(method)) {
      notifyAdminsOfOrder({
        code: order.order_code,
        customer: order.customer_name,
        city: order.customer_city,
        total: order.total,
        payment_method: method,
      }).catch((err: unknown) => {
        console.error('[orders] admin notify failed:', err);
      });
    }

    const payment = buildPaymentPayload(settings, method, starsInvoiceUrl, stripeCheckoutUrl);

    console.log(`[order] ${order.order_code} placed by ${me.id} method=${method} total=${total}`);

    return reply.code(201).send({ order, payment });
  });

  app.post('/api/orders/:id/proof', { preHandler: requireAuth }, async (req, reply) => {
    const me = currentProfile(req);
    const { id } = req.params as { id: string };
    const body = ProofSubmitSchema.parse(req.body);

    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.user_id !== me.id) throw new HttpError(403, 'Not your order');
    if (order.status !== 'Pending payment') {
      throw new HttpError(409, 'This order is no longer awaiting payment.');
    }

    const now = new Date().toISOString();
    const updates: Record<string, string | null> = {
      payment_proof_note: body.note || null,
      payment_tx_hash: body.tx_hash || null,
      payment_proof_url: body.proof_url || null,
      payment_proof_submitted_at: now,
    };

    const { data: updated, error } = await supabaseAdmin
      .from('orders')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error || !updated) throw new HttpError(500, error?.message ?? 'update failed');

    notifyAdminsOfOrder({
      code: updated.order_code,
      customer: updated.customer_name,
      city: updated.customer_city,
      total: updated.total,
      payment_method: `${updated.payment_method} · proof submitted`,
    }).catch((err: unknown) => {
      console.error('[orders] proof notify failed:', err);
    });

    return reply.send({ order: updated as Order });
  });
};
