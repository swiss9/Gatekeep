import type { FastifyPluginAsync } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { HttpError, requireRole, currentProfile } from '../middleware/auth.js';
import { SettingsUpdateSchema, OrderStatusUpdateSchema } from '../schemas.js';
import {
  deliverDigitalProduct,
  notifyBuyerOfDelivery,
  notifyBuyerPaymentConfirmed,
} from '../bot.js';
import type { Order, OrderItem, Product, Profile, StoreSettings } from '../types.js';

const STALE_PENDING_HOURS = 2;

function isFresh(o: Order): boolean {
  if (o.status !== 'Pending payment') return true;
  if (o.payment_proof_submitted_at) return true;
  return new Date(o.created_at).getTime() > Date.now() - STALE_PENDING_HOURS * 3600_000;
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  const admin = { preHandler: requireRole('admin', 'superadmin') };

  app.patch('/api/admin/settings', admin, async (req, reply) => {
    const body = SettingsUpdateSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('store_settings')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', 1).select().single();
    if (error || !data) throw new HttpError(500, error?.message ?? 'settings update failed');
    return reply.send({ store: data as StoreSettings });
  });

  app.get('/api/admin/orders', admin, async (req, reply) => {
    const q = req.query as { status?: string; include_stale?: string };
    const includeStale = q.include_stale === '1';

    let query = supabaseAdmin.from('orders').select('*')
      .order('created_at', { ascending: false });
    if (q.status && q.status !== 'All') query = query.eq('status', q.status);

    const { data: orders, error } = await query;
    if (error) throw new HttpError(500, error.message);

    const visible = includeStale
      ? (orders as Order[]) ?? []
      : ((orders as Order[]) ?? []).filter(isFresh);

    const ids = visible.map((o) => o.id);
    const { data: items } = ids.length
      ? await supabaseAdmin.from('order_items').select('*').in('order_id', ids)
      : { data: [] as OrderItem[] };

    const ordersWithSigned: Array<Order & { payment_proof_signed_url: string | null }> = [];
    for (const o of visible) {
      let signed: string | null = null;
      if (o.payment_proof_url) {
        const { data } = await supabaseAdmin.storage
          .from('receipts').createSignedUrl(o.payment_proof_url, 60 * 30);
        signed = data?.signedUrl ?? null;
      }
      ordersWithSigned.push({ ...o, payment_proof_signed_url: signed });
    }

    return reply.send({ orders: ordersWithSigned, items: (items as OrderItem[]) ?? [] });
  });

  app.post('/api/admin/orders/:id/confirm-paid', admin, async (req, reply) => {
    const me = currentProfile(req);
    const { id } = req.params as { id: string };

    const { data: existing } = await supabaseAdmin
      .from('orders').select('*').eq('id', id).maybeSingle();
    if (!existing) throw new HttpError(404, 'Order not found');
    if (existing.status !== 'Pending payment') {
      throw new HttpError(409, 'Order is not awaiting payment.');
    }

    const now = new Date().toISOString();
    const { data: updated, error } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'Paid',
        payment_confirmed_at: now,
        paid_confirmed_at: now,
        paid_confirmed_by: me.id,
      })
      .eq('id', id).select().single();
    if (error || !updated) throw new HttpError(500, error?.message ?? 'confirm failed');

    if (updated.user_id) {
      const { data: profile } = await supabaseAdmin
        .from('profiles').select('telegram_id').eq('id', updated.user_id).maybeSingle();
      if (profile?.telegram_id) {
        await notifyBuyerPaymentConfirmed({
          telegramId: Number(profile.telegram_id),
          orderCode: updated.order_code,
        });
      }
    }

    return reply.send({ order: updated as Order });
  });

  app.post('/api/admin/orders/:id/simulate-paid', admin, async (req, reply) => {
    const me = currentProfile(req);
    const { id } = req.params as { id: string };

    const { data: existing } = await supabaseAdmin
      .from('orders').select('*').eq('id', id).maybeSingle();
    if (!existing) throw new HttpError(404, 'Order not found');
    if (existing.status !== 'Pending payment') {
      throw new HttpError(409, 'Order is not awaiting payment.');
    }

    const now = new Date().toISOString();
    const { data: updated, error } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'Paid',
        payment_confirmed_at: now,
        paid_confirmed_at: now,
        paid_confirmed_by: me.id,
        payment_simulated: true,
      })
      .eq('id', id).select().single();
    if (error || !updated) throw new HttpError(500, error?.message ?? 'simulate failed');

    if (updated.user_id) {
      const { data: profile } = await supabaseAdmin
        .from('profiles').select('telegram_id').eq('id', updated.user_id).maybeSingle();
      if (profile?.telegram_id) {
        await notifyBuyerPaymentConfirmed({
          telegramId: Number(profile.telegram_id),
          orderCode: updated.order_code,
        });
      }
    }

    console.log(`[admin] order ${updated.order_code} marked paid as SIMULATION by ${me.id}`);
    return reply.send({ order: updated as Order });
  });

  app.patch('/api/admin/orders/:id', admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = OrderStatusUpdateSchema.parse(req.body);

    const { data: existing } = await supabaseAdmin
      .from('orders').select('*').eq('id', id).maybeSingle();
    if (!existing) throw new HttpError(404, 'Order not found');

    const updates: Record<string, string | null> = { status: body.status };
    if (body.status === 'Paid' && !existing.payment_confirmed_at) {
      updates.payment_confirmed_at = new Date().toISOString();
      updates.paid_confirmed_at = new Date().toISOString();
    }
    if (body.status === 'Delivered' && !existing.delivered_at) {
      updates.delivered_at = new Date().toISOString();
    }

    const { data: updated, error } = await supabaseAdmin
      .from('orders').update(updates).eq('id', id).select().single();
    if (error || !updated) throw new HttpError(404, 'Order not found');

    if (body.status === 'Delivered' && existing.status !== 'Delivered') {
      const order = updated as Order;
      const { data: items } = await supabaseAdmin
        .from('order_items').select('*').eq('order_id', order.id);
      const rows = (items as OrderItem[]) ?? [];

      let buyerTelegramId: number | null = null;
      if (order.user_id) {
        const { data: profile } = await supabaseAdmin
          .from('profiles').select('telegram_id').eq('id', order.user_id).maybeSingle();
        if (profile?.telegram_id) buyerTelegramId = Number(profile.telegram_id);
      }

      if (buyerTelegramId) {
        const productIds = rows.map((r) => r.product_id).filter((x): x is string => !!x);
        if (productIds.length > 0) {
          const { data: products } = await supabaseAdmin
            .from('products').select('*').in('id', productIds);
          const byId = new Map(((products as Product[]) ?? []).map((p) => [p.id, p]));

          for (const line of rows) {
            if (!line.product_id) continue;
            const p = byId.get(line.product_id);
            if (!p || p.delivery_type !== 'digital') continue;
            const paths = p.digital_file_paths ?? [];
            if (paths.length === 0) continue;

            // Sign each file path, label each with an index when there
            // are multiple files for a single product.
            const files: Array<{ label: string; url: string }> = [];
            for (let i = 0; i < paths.length; i++) {
              const path = paths[i];
              if (!path) continue;
              const { data, error } = await supabaseAdmin.storage
                .from('digital-goods').createSignedUrl(path, 60 * 60 * 24);
              if (error || !data?.signedUrl) continue;
              const label =
                paths.length === 1
                  ? 'Download'
                  : `Download ${i + 1} / ${paths.length}`;
              files.push({ label, url: data.signedUrl });
            }

            if (files.length > 0) {
              await deliverDigitalProduct({
                telegramId: buyerTelegramId,
                orderCode: order.order_code,
                productName: p.name,
                files,
              });
            }
          }
        }

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
      .select('id,total,status,created_at,payment_proof_submitted_at')
      .neq('status', 'Cancelled');
    if (error) throw new HttpError(500, error.message);

    const rows = (orders as Array<{
      total: number; created_at: string; status: string;
      payment_proof_submitted_at: string | null;
    }>) ?? [];
    const revenue = rows.reduce((s, o) => s + Number(o.total), 0);

    const { count: adminCount } = await supabaseAdmin
      .from('profiles').select('id', { count: 'exact', head: true })
      .in('role', ['admin', 'superadmin']);

    const cutoffMs = Date.now() - STALE_PENDING_HOURS * 3600_000;
    const pendingConfirmations = rows.filter(
      (o) =>
        o.status === 'Pending payment' &&
        (o.payment_proof_submitted_at || new Date(o.created_at).getTime() > cutoffMs),
    ).length;

    const { data: recent } = await supabaseAdmin
      .from('orders').select('*').order('created_at', { ascending: false }).limit(20);
    const recentFresh = ((recent as Order[]) ?? []).filter(isFresh).slice(0, 5);

    return reply.send({
      revenue, orderCount: rows.length,
      adminCount: adminCount ?? 0,
      pendingConfirmations,
      recentOrders: recentFresh,
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
