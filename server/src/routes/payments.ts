import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { env } from '../env.js';
import { supabaseAdmin } from '../supabase.js';
import { notifyBuyerPaymentConfirmed } from '../bot.js';

function verifyStripeSignature(rawBody: Buffer, header: string, secret: string): boolean {
  const parts: Record<string, string> = {};
  for (const p of header.split(',')) {
    const idx = p.indexOf('=');
    if (idx === -1) continue;
    const k = p.slice(0, idx);
    const v = p.slice(idx + 1);
    if (k && v && !parts[k]) parts[k] = v;
  }
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;

  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const signed = `${t}.${rawBody.toString('utf8')}`;
  const expected = createHmac('sha256', secret).update(signed).digest();
  const provided = Buffer.from(v1, 'hex');
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

type StripeSession = {
  id: string;
  client_reference_id?: string | null;
  payment_status?: string;
  amount_total?: number;
  currency?: string;
};

export const paymentRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/payments/stripe/webhook', async (req: FastifyRequest, reply) => {
    const secret = env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      return reply.code(503).send({ error: 'Stripe webhook not configured' });
    }

    const sigHeader = req.headers['stripe-signature'];
    if (typeof sigHeader !== 'string') {
      return reply.code(400).send({ error: 'Missing stripe-signature' });
    }

    const raw = (req as FastifyRequest & { rawBody?: Buffer }).rawBody;
    if (!raw) {
      return reply.code(400).send({ error: 'Missing raw body' });
    }

    if (!verifyStripeSignature(raw, sigHeader, secret)) {
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    let event: { type?: string; data?: { object?: unknown } };
    try {
      event = JSON.parse(raw.toString('utf8')) as typeof event;
    } catch {
      return reply.code(400).send({ error: 'Invalid JSON' });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object as StripeSession | undefined;
      const orderCode = session?.client_reference_id;
      if (orderCode && session?.payment_status === 'paid') {
        await markPaidByOrderCode(orderCode);
      }
    }

    return reply.send({ received: true });
  });
};

async function markPaidByOrderCode(orderCode: string): Promise<void> {
  const now = new Date().toISOString();
  const { data: updated } = await supabaseAdmin
    .from('orders')
    .update({
      status: 'Paid',
      payment_confirmed_at: now,
      paid_confirmed_at: now,
    })
    .eq('order_code', orderCode)
    .eq('status', 'Pending payment')
    .select('id, order_code, user_id')
    .maybeSingle();

  if (!updated) {
    // Idempotent no-op. Either the order doesn't exist, was already
    // marked paid by an admin, or was cancelled. Stripe retries are safe.
    console.log(`[stripe] webhook for order_code=${orderCode} — nothing to do`);
    return;
  }

  if (updated.user_id) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('telegram_id')
      .eq('id', updated.user_id)
      .maybeSingle();
    if (profile?.telegram_id) {
      await notifyBuyerPaymentConfirmed({
        telegramId: Number(profile.telegram_id),
        orderCode: updated.order_code,
      });
    }
  }

  console.log(`[stripe] order ${updated.order_code} marked paid`);
}
