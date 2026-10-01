import type { FastifyPluginAsync } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { HttpError, requireRole } from '../middleware/auth.js';
import { SettingsUpdateSchema, OrderStatusUpdateSchema } from '../schemas.js';
import { deliverDigitalGood, notifyBuyerOfDelivery } from '../bot.js';
import type { Order, OrderItem, Product, Profile, StoreSettings } from '../types.js';

export const adminRoutes: FastifyPluginAsync = async (app) => {
  const admin = { preHandler: requireRole('admin', 'superadmin') };

  app.patch('/api/admin/settings', admin, async (req, reply) => {
    const body = SettingsUpdateSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('store_settings')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', 1)
      .select()
      .single();
    if (error || !data) throw new HttpError(500, error?.message ?? 'settings update failed');
    return reply.send({ store: data as StoreSettings });
  });

  app.get('/api/admin/orders', admin, async (req, reply) => {
    const q = req.query as { status?: string };
    let query = supabaseAdmin.from('orders').select('*').order('created_at', { ascending: false });
    if (q.status && q.status !== 'All') query = query.eq('status', q.status);

    const { data: orders, error } = await query;
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

  app.patch('/api/admin/orders/:id', admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = OrderStatusUpdateSchema.parse(req.body);

    const { data: existing } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!existing) throw new HttpError(404, 'Order not found');

    const updates: Partial<Order> & { payment_confirmed_at?: string | null; delivered_at?: string | null } = {
      status: body.status,
    };
    if (body.status === 'Paid' && !existing.payment_confirmed_at) {
      updates.payment_confirmed_at = new Date().toISOString();
    }
    if (body.status === 'Delivered' && !existing.delivered_at) {
      updates.delivered_at = new Date().toISOString();
    }

    const { data: updated, error } = await supabaseAdmin
      .from('orders')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error || !updated) throw new HttpError(404, 'Order not found');

    // On the transition to Delivered, notify the buyer and (if any line
    // is digital) send the download link automatically.
    if (body.status === 'Delivered' && existing.status !== 'Delivered') {
      const order = updated as Order;
      const { data: items } = await supabaseAdmin
        .from('order_items')
        .select('*')
        .eq('order_id', order.id);
      const rows = (items as OrderItem[]) ?? [];

      // Buyer's Telegram ID
      let buyerTelegramId: number | null = null;
      if (order.user_id) {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('telegram_id')
          .eq('id', order.user_id)
          .maybeSingle();
        if (profile?.telegram_id) buyerTelegramId = Number(profile.telegram_id);
      }

      if (buyerTelegramId) {
        // Digital delivery for every digital line.
        const productIds = rows.map((r) => r.product_id).filter((x): x is string => !!x);
        if (productIds.length > 0) {
          const { data: products } = await supabaseAdmin
            .from('products')
            .select('*')
            .in('id', productIds);
          const byId = new Map(((products as Product[]) ?? []).map((p) => [p.id, p]));

          for (const line of rows) {
            if (!line.product_id) continue;
            const p = byId.get(line.product_id);
            if (!p || p.delivery_type !== 'digital' || !p.digital_file_path) continue;

            await deliverDigitalGood({
              telegramId: buyerTelegramId,
              orderCode: order.order_code,
              productName: p.name,
              filePath: p.digital_file_path,
            });
          }
        }

        // Always send the generic "order is ready" ping too.
        await notifyBuyerOfDelivery({
          telegramId: buyerTelegramId,
          orderCode: order.order_code,
        });
      }
    }

    return reply.send({ order: updated as Order });
  });

  app.get('/api/admin/overview', admin, async (_req, reply) => {
    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select('id,total,status,created_at')
      .neq('status', 'Cancelled');
    if (error) throw new HttpError(500, error.message);

    const rows = (orders as { total: number; created_at: string }[]) ?? [];
    const revenue = rows.reduce((s, o) => s + Number(o.total), 0);

    const { count: adminCount } = await supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .in('role', ['admin', 'superadmin']);

    const { data: recent } = await supabaseAdmin
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    return reply.send({
      revenue,
      orderCount: rows.length,
      adminCount: adminCount ?? 0,
      recentOrders: (recent as Order[]) ?? [],
    });
  });

  app.get('/api/admin/team', admin, async (_req, reply) => {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id,telegram_id,username,first_name,role,invited_by,created_at')
      .in('role', ['admin', 'superadmin'])
      .order('created_at', { ascending: true });
    if (error) throw new HttpError(500, error.message);
    return reply.send({ team: (data as Profile[]) ?? [] });
  });
};
