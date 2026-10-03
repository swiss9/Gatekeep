import type { FastifyPluginAsync } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { HttpError, requireRole, currentProfile } from '../middleware/auth.js';
import { SettingsUpdateSchema, OrderStatusUpdateSchema } from '../schemas.js';
import {
  finalizeDigitalDelivery,
  notifyBuyerOfDelivery,
  notifyBuyerPaymentConfirmed,
} from '../bot.js';
import type { Order, OrderItem, Profile, StoreSettings } from '../types.js';

const STALE_PENDING_HOURS = 2;

function isFresh(o: Order): boolean {
  if (o.status !== 'Pending payment') return true;
  if (o.payment_proof_submitted_at) return true;
  return new Date(o.created_at).getTime() > Date.now() - STALE_PENDING_HOURS * 3600_000;
}

/**
 * Shared post-Paid work: notify buyer, deliver digital files, and if the
 * order has nothing to physically ship, flip status to Delivered.
 */
async function completePaidOrder(order: {
  id: string;
  order_code: string;
  user_id: string | null;
}): Promise<void> {
  if (order.user_id) {
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('telegram_id').eq('id', order.user_id).maybeSingle();
    if (profile?.telegram_id) {
      await notifyBuyerPaymentConfirmed({
        telegramId: Number(profile.telegram_id),
        orderCode: order.order_code,
      });
    }
  }

  const { noShipping } = await finalizeDigitalDelivery(order);

  if (noShipping) {
    await supabaseAdmin
      .from('orders')
      .update({ status: 'Delivered', delivered_at: new Date().toISOString() })
      .eq('id', order.id);
  }
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

    const now = new Date().toISOString();
    const { data: updated } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'Paid',
        payment_confirmed_at: now,
        paid_confirmed_at: now,
        paid_confirmed_by: me.id,
      })
      .eq('id', id)
      .eq('status', 'Pending payment')
      .select('id, order_code, user_id')
      .maybeSingle();
    if (!updated) throw new HttpError(409, 'Order is not awaiting payment.');

    await completePaidOrder(updated);

    // Return the possibly-Delivered order.
    const { data: fresh } = await supabaseAdmin
      .from('orders').select('*').eq('id', id).single();
    return reply.send({ order: fresh as Order });
  });

  app.post('/api/admin/orders/:id/simulate-paid', admin, async (req, reply) => {
    const me = currentProfile(req);
    const { id } = req.params as { id: string };

    const now = new Date().toISOString();
    const { data: updated } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'Paid',
        payment_confirmed_at: now,
        paid_confirmed_at: now,
        paid_confirmed_by: me.id,
        payment_simulated: true,
      })
      .eq('id', id)
      .eq('status', 'Pending payment')
      .select('id, order_code, user_id')
      .maybeSingle();
    if (!updated) throw new HttpError(409, 'Order is not awaiting payment.');

    console.log(`[admin] order ${updated.order_code} marked paid as SIMULATION by ${me.id}`);
    await completePaidOrder(updated);

    const { data: fresh } = await supabaseAdmin
      .from('orders').select('*').eq('id', id).single();
    return reply.send({ order: fresh as Order });
  });

  app.patch('/api/admin/orders/:id', admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = OrderStatusUpdateSchema.parse(req.body);

    const { data: existing } = await supabaseAdmin
      .from('orders').select('*').eq('id', id).maybeSingle();
    if (!existing) throw new HttpError(404, 'Order not found');

    const now = new Date().toISOString();
    const updates: Record<string, string | null> = { status: body.status };
    if (body.status === 'Paid' && !existing.payment_confirmed_at) {
      updates.payment_confirmed_at = now;
      updates.paid_confirmed_at = now;
    }
    if (body.status === 'Delivered' && !existing.delivered_at) {
      updates.delivered_at = now;
    }

    const { data: updated } = await supabaseAdmin
      .from('orders').update(updates).eq('id', id)
      .select('id, order_code, user_id, status').single();
    if (!updated) throw new HttpError(404, 'Order not found');

    const transitioningToPaid =
      body.status === 'Paid' && existing.status !== 'Paid' &&
      existing.status !== 'Processing' && existing.status !== 'In transit' &&
      existing.status !== 'Delivered';

    const transitioningToDelivered =
      body.status === 'Delivered' && existing.status !== 'Delivered';

    if (transitioningToPaid) {
      await completePaidOrder(updated);
    } else if (transitioningToDelivered) {
      // Digital files were already delivered at Paid time. Just send
      // the shipment ping.
      if (updated.user_id) {
        const { data: profile } = await supabaseAdmin
          .from('profiles').select('telegram_id').eq('id', updated.user_id).maybeSingle();
        if (profile?.telegram_id) {
          await notifyBuyerOfDelivery({
            telegramId: Number(profile.telegram_id),
            orderCode: updated.order_code,
          });
        }
      }
    }

    const { data: fresh } = await supabaseAdmin
      .from('orders').select('*').eq('id', id).single();
    return reply.send({ order: fresh as Order });
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
