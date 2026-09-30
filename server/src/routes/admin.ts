import type { FastifyPluginAsync } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { HttpError, requireRole } from '../middleware/auth.js';
import { SettingsUpdateSchema, OrderStatusUpdateSchema } from '../schemas.js';
import type { Order, OrderItem, Profile, StoreSettings } from '../types.js';

export const adminRoutes: FastifyPluginAsync = async (app) => {
  const admin = { preHandler: requireRole('admin', 'superadmin') };

  // ---- Settings ----
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

  // ---- Orders ----
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
    const { data, error } = await supabaseAdmin
      .from('orders')
      .update({ status: body.status })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new HttpError(404, 'Order not found');
    return reply.send({ order: data as Order });
  });

  // ---- Overview stats ----
  app.get('/api/admin/overview', admin, async (_req, reply) => {
    // Non-cancelled orders only — cancelled orders should not inflate revenue.
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

  // ---- Team list ----
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
