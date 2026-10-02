import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type Stripe from 'stripe';
import { env } from '../env.js';
import { supabaseAdmin } from '../supabase.js';
import { stripeClient, stripeWebhookConfigured } from '../stripe.js';
import { notifyBuyerPaymentConfirmed } from '../bot.js';

export const paymentRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/payments/stripe/webhook', async (req: FastifyRequest, reply) => {
    if (!stripeWebhookConfigured()) {
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

    // Stripe's own verifier. Handles multi-signature during key rotation,
    // timestamps, and returns a typed Event.
    let event: Stripe.Event;
    try {
      event = stripeClient().webhooks.constructEvent(
        raw,
        sigHeader,
        env.STRIPE_WEBHOOK_SECRET as string,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'signature check failed';
      console.warn(`[stripe] webhook rejected: ${msg}`);
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.payment_status === 'paid' && session.client_reference_id) {
            await markPaidByOrderCode(session.client_reference_id);
          }
          break;
        }
        case 'checkout.session.expired': {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.client_reference_id) {
            await cancelUnpaidOrder(session.client_reference_id);
          }
          break;
        }
        default:
          // Ignore everything else.
          break;
      }
    } catch (err) {
      // Log the failure but return 200 so Stripe does not retry
      // indefinitely — a code bug would otherwise storm our endpoint.
      console.error(`[stripe] handler for ${event.type} failed:`, err);
    }

    return reply.send({ received: true });
  });
};

/**
 * Marks an order paid. Compare-and-set on status ensures this is safe
 * against a concurrent admin "Confirm paid" click — both paths require
 * the order to still be 'Pending payment' at write time.
 */
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
    // Either the order doesn't exist, was already marked paid, or was
    // cancelled. Stripe retries are safe.
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

/**
 * Fires when a Checkout Session expires (24h after creation). Cancels
 * the order if it is still pending, and restores any stock that was
 * decremented when the order was placed.
 */
async function cancelUnpaidOrder(orderCode: string): Promise<void> {
  const { data: cancelled } = await supabaseAdmin
    .from('orders')
    .update({ status: 'Cancelled' })
    .eq('order_code', orderCode)
    .eq('status', 'Pending payment')
    .select('id, order_code')
    .maybeSingle();

  if (!cancelled) return;

  // Restore stock for physical lines.
  const { data: items } = await supabaseAdmin
    .from('order_items')
    .select('product_id, quantity')
    .eq('order_id', cancelled.id);

  for (const line of (items ?? []) as Array<{ product_id: string | null; quantity: number }>) {
    if (!line.product_id) continue;
    const { data: p } = await supabaseAdmin
      .from('products')
      .select('delivery_type, stock')
      .eq('id', line.product_id)
      .maybeSingle();
    if (!p || p.delivery_type !== 'physical') continue;
    await supabaseAdmin
      .from('products')
      .update({ stock: Number(p.stock) + line.quantity })
      .eq('id', line.product_id);
  }

  console.log(`[stripe] order ${cancelled.order_code} cancelled (session expired)`);
}
