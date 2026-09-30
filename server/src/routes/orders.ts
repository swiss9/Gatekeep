import type { FastifyPluginAsync } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { HttpError, requireAuth, currentProfile } from '../middleware/auth.js';
import { OrderCreateSchema } from '../schemas.js';
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

export const orderRoutes: FastifyPluginAsync = async (app) => {
  /** GET /api/orders/mine */
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

  /** POST /api/orders */
  app.post('/api/orders', { preHandler: requireAuth }, async (req, reply) => {
    const me = currentProfile(req);
    const body = OrderCreateSchema.parse(req.body);

    // ---- Rate limit ----
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

    // ---- Revalidate stock & price from the DB. Never trust the client. ----
    // This is a friendly pre-check that produces good error messages.
    // The authoritative check is the decrement_stock RPC below, which is
    // race-safe under concurrent orders.
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
      if (p.stock < line.quantity) {
        throw new HttpError(409, `Only ${p.stock} of "${p.name}" left in stock.`);
      }
    }

    // ---- Totals ----
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

    // ---- Insert order (retry on the unlikely order_code collision) ----
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
          status: 'Processing',
          payment_method: body.payment_method,
          subtotal,
          shipping,
          total,
        })
        .select()
        .single();
      if (error?.code === '23505') continue; // order_code collision — retry
      if (error || !data) throw new HttpError(500, error?.message ?? 'order insert failed');
      order = data as Order;
    }
    if (!order) throw new HttpError(500, 'Could not generate a unique order code');

    // ---- Insert line items ----
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
      // Roll back the order rather than leaving a headless record.
      await supabaseAdmin.from('orders').delete().eq('id', order.id);
      throw new HttpError(500, `order_items failed: ${liErr.message}`);
    }

    // ---- Atomic stock decrement via RPC ----
    // decrement_stock(p_product_id, p_qty) runs UPDATE ... WHERE stock >= qty
    // inside a single statement, so concurrent checkouts cannot lose an
    // update. It returns false if the row no longer had enough stock.
    //
    // Cleanup contract (Option A): if any line fails, we delete the order
    // we just created and let the ON DELETE CASCADE on order_items take
    // care of the line rows. That leaves no partial state — but it is not
    // one transaction, so a crash between the delete and the throw could
    // still leave a stranded order. A full transactional wrap (create
    // order + items + decrements inside a single RPC) is a v2 improvement.
    for (const line of body.items) {
      const { data: ok, error: decErr } = await supabaseAdmin.rpc('decrement_stock', {
        p_product_id: line.product_id,
        p_qty: line.quantity,
      });
      if (decErr) {
        // Unexpected DB failure — same cleanup path.
        await supabaseAdmin.from('orders').delete().eq('id', order.id);
        throw new HttpError(500, decErr.message);
      }
      if (!ok) {
        // Lost the race: someone else drained the stock between our
        // pre-check and this RPC call.
        await supabaseAdmin.from('orders').delete().eq('id', order.id);
        throw new HttpError(409, 'Stock changed during checkout. Please retry.');
      }
    }

    // ---- Telegram receipt (stubbed for v1) ----
    // TODO(v2): send a Telegram message to the buyer via Bot API.
    // eslint-disable-next-line no-console
    console.log(`[order] ${order.order_code} placed by ${me.id} total=${total}`);

    return reply.code(201).send({ order });
  });
};
