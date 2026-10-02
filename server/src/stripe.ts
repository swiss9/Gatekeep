import Stripe from 'stripe';
import { env } from './env.js';
import { HttpError } from './middleware/auth.js';

/**
 * Lazy singleton. The SDK constructor throws if the key is missing, so
 * we defer construction until the first Stripe call. This lets a store
 * that doesn't use Stripe boot without STRIPE_SECRET_KEY.
 *
 * No `apiVersion` is passed — the SDK uses the version it was built
 * against. Pinning by date means every SDK upgrade breaks the build
 * until you bump the string. Let the SDK own it.
 */
let client: Stripe | null = null;

function getClient(): Stripe {
  if (client) return client;
  if (!env.STRIPE_SECRET_KEY) {
    throw new HttpError(
      503,
      'Stripe is not configured on the server. Set STRIPE_SECRET_KEY.',
    );
  }
  client = new Stripe(env.STRIPE_SECRET_KEY, {
    typescript: true,
  });
  return client;
}

/** Returns a lazily-constructed client for the webhook handler. */
export function stripeClient(): Stripe {
  return getClient();
}

/** True if a signing secret is present. Used by the webhook route. */
export function stripeWebhookConfigured(): boolean {
  return typeof env.STRIPE_WEBHOOK_SECRET === 'string' && env.STRIPE_WEBHOOK_SECRET.length > 0;
}

export type CheckoutLine = {
  name: string;
  unit_price: number;
  quantity: number;
};

export type CreateCheckoutParams = {
  orderCode: string;
  orderId: string;
  lines: CheckoutLine[];
  shipping: number;
  currencyCode: string;
};

export async function createStripeCheckoutSession(
  params: CreateCheckoutParams,
): Promise<string> {
  const stripe = getClient();

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = params.lines.map(
    (l) => ({
      price_data: {
        currency: params.currencyCode,
        product_data: { name: l.name.slice(0, 250) },
        unit_amount: Math.round(l.unit_price * 100),
      },
      quantity: l.quantity,
    }),
  );

  if (params.shipping > 0) {
    lineItems.push({
      price_data: {
        currency: params.currencyCode,
        product_data: { name: 'Shipping' },
        unit_amount: Math.round(params.shipping * 100),
      },
      quantity: 1,
    });
  }

  const returnUrl = env.TELEGRAM_BOT_USERNAME
    ? `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp=paid_${params.orderCode}`
    : env.MINI_APP_URL;

  const cancelUrl = env.TELEGRAM_BOT_USERNAME
    ? `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp=cancelled_${params.orderCode}`
    : env.MINI_APP_URL;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    client_reference_id: params.orderCode,
    metadata: {
      order_id: params.orderId,
      order_code: params.orderCode,
    },
    success_url: returnUrl,
    cancel_url: cancelUrl,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
  });

  if (!session.url) {
    throw new HttpError(502, 'Stripe did not return a checkout URL.');
  }
  return session.url;
}
