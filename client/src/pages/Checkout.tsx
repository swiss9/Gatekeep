import { useEffect, useMemo, useState } from 'react';
import {
  api,
  formatMoney,
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
  type StoreSettings,
} from '../lib/api';
import { haptic, openExternalLink, openInvoice } from '../lib/telegram';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useToast } from '../context/ToastContext';
import { useRouter } from '../App';
import { PastelThumb } from '../components/PastelThumb';

type Delivery = { name: string; address: string; city: string; zip: string };
type FieldErrors = Partial<Record<keyof Delivery, boolean>>;

type MethodMeta = {
  id: PaymentMethod;
  name: string;
  sub: string;
};

const METHOD_META: Record<PaymentMethod, { name: string; sub: string }> = {
  stars: { name: 'Telegram Stars', sub: 'pay inside Telegram' },
  stripe: { name: 'Card', sub: 'via Stripe' },
  bank: { name: 'Bank transfer', sub: 'manual confirmation' },
  crypto: { name: 'Crypto', sub: 'BTC · ETH · USDT · TON' },
  cod: { name: 'Cash on Delivery', sub: 'pay on delivery' },
  manual: { name: 'Arrange with seller', sub: 'we message you' },
};

export function Checkout() {
  const { back, navigate } = useRouter();
  const { items, remove, clear } = useCart();
  const auth = useAuth();
  const toast = useToast();

  const [delivery, setDelivery] = useState<Delivery>({
    name: auth.status === 'ready' ? (auth.profile.first_name ?? '') : '',
    address: '',
    city: '',
    zip: '',
  });
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [store, setStore] = useState<StoreSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .store()
      .then((s) => {
        if (!cancelled) setStore(s.store);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const needsAddress = useMemo(
    () => items.some((i) => i.product.delivery_type === 'physical'),
    [items],
  );

  const availableMethods = useMemo<MethodMeta[]>(() => {
    if (!store) return [];
    const out: MethodMeta[] = [];
    if (store.stars_enabled) out.push({ id: 'stars', ...METHOD_META.stars });
    if (store.stripe_enabled) out.push({ id: 'stripe', ...METHOD_META.stripe });
    if (store.bank_enabled && store.bank_details.trim())
      out.push({ id: 'bank', ...METHOD_META.bank });
    if (store.crypto_enabled) out.push({ id: 'crypto', ...METHOD_META.crypto });
    out.push({ id: 'cod', ...METHOD_META.cod });
    out.push({ id: 'manual', ...METHOD_META.manual });
    return out;
  }, [store]);

  // Pick a sane default once methods are known.
  useEffect(() => {
    if (method !== null) return;
    const first = availableMethods[0];
    if (first) setMethod(first.id);
  }, [availableMethods, method]);

  const currency = store?.currency_symbol ?? '$';
  const threshold = store?.shipping_threshold ?? 60;
  const shipCost = store?.shipping_cost ?? 6;

  const subtotal = items.reduce((n, i) => n + i.product.price * i.quantity, 0);
  const shipping = needsAddress && subtotal < threshold ? shipCost : 0;
  const total = subtotal + shipping;

  if (items.length === 0) {
    return (
      <section className="screen active">
        <div className="topbar">
          <button type="button" className="icon-btn" aria-label="Back" onClick={back}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="m14.5 6-6 6 6 6" />
            </svg>
          </button>
          <span className="topbar-title">Checkout</span>
          <span style={{ width: 42 }} />
        </div>
        <div className="empty" style={{ marginTop: 20 }}>
          <p>Your cart is empty.</p>
          <button type="button" className="link-btn" onClick={() => navigate({ name: 'shop' })}>
            Back to shop
          </button>
        </div>
      </section>
    );
  }

  const submit = async () => {
    if (!method) {
      toast('Pick a payment method');
      return;
    }
    const nextErrors: FieldErrors = {
      name: !delivery.name.trim(),
      address: needsAddress ? !delivery.address.trim() : false,
      city: needsAddress ? !delivery.city.trim() : false,
    };
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      toast(needsAddress ? 'Please fill in delivery details' : 'Please enter your name');
      return;
    }
    setSubmitting(true);
    try {
      const { order, payment } = await api.createOrder({
        items: items.map((i) => ({ product_id: i.product.id, quantity: i.quantity })),
        delivery: {
          name: delivery.name.trim(),
          address: needsAddress ? delivery.address.trim() : '',
          city: needsAddress ? delivery.city.trim() : '',
          zip: delivery.zip.trim() || undefined,
        },
        payment_method: method,
      });
      haptic('heavy');
      clear();

      if (payment.kind === 'stars') {
        // Open Telegram's native Stars invoice. The order is only marked
        // Paid server-side once Telegram confirms — so navigate straight
        // away and let the confirmation screen poll.
        openInvoice(payment.invoice_url, (status) => {
          if (status === 'paid') {
            navigate({ name: 'confirmation', orderCode: order.order_code });
          } else if (status === 'cancelled' || status === 'failed') {
            toast('Payment cancelled');
            navigate({ name: 'confirmation', orderCode: order.order_code });
          } else {
            // pending — navigate anyway, confirmation polls.
            navigate({ name: 'confirmation', orderCode: order.order_code });
          }
        });
        return;
      }

      if (payment.kind === 'stripe') {
        openExternalLink(payment.url);
        navigate({ name: 'confirmation', orderCode: order.order_code });
        return;
      }

      // bank / crypto / cod / manual / none — straight to instructions.
      navigate({ name: 'confirmation', orderCode: order.order_code });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Order failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="screen cta-screen active">
      <div className="topbar">
        <button type="button" className="icon-btn" aria-label="Back" onClick={back}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="m14.5 6-6 6 6 6" />
          </svg>
        </button>
        <span className="topbar-title">Checkout</span>
        <span style={{ width: 42 }} />
      </div>

      <span className="section-title">Your Items</span>
      <div style={{ marginTop: 12 }}>
        {items.map((i) => (
          <div className="ck-item" key={i.product.id}>
            <PastelThumb product={i.product} initialSize={22} className="ck-thumb" />
            <div className="ck-info">
              <div className="ck-name">{i.product.name}</div>
              <div className="ck-qty">Qty {i.quantity}</div>
            </div>
            <span className="ck-price">{formatMoney(i.product.price * i.quantity, currency)}</span>
            <button
              type="button"
              className="x-btn"
              aria-label="Remove"
              onClick={() => {
                remove(i.product.id);
                if (items.length === 1) navigate({ name: 'shop' });
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <span className="section-title" style={{ display: 'block', marginTop: 22 }}>
        {needsAddress ? 'Delivery' : 'Contact'}
      </span>
      <div className="panel">
        <div className={`field${errors.name ? ' error' : ''}`}>
          <label>Full name</label>
          <input
            type="text"
            value={delivery.name}
            onChange={(e) => setDelivery({ ...delivery, name: e.target.value })}
            placeholder="Jane Cooper"
          />
        </div>
        {needsAddress && (
          <>
            <div className={`field${errors.address ? ' error' : ''}`}>
              <label>Address</label>
              <input
                type="text"
                value={delivery.address}
                onChange={(e) => setDelivery({ ...delivery, address: e.target.value })}
                placeholder="226 Mercer Street"
              />
            </div>
            <div className="field-row" style={{ marginBottom: 0 }}>
              <div className={`field${errors.city ? ' error' : ''}`} style={{ marginBottom: 0 }}>
                <label>City</label>
                <input
                  type="text"
                  value={delivery.city}
                  onChange={(e) => setDelivery({ ...delivery, city: e.target.value })}
                  placeholder="New York"
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>ZIP</label>
                <input
                  type="text"
                  value={delivery.zip}
                  onChange={(e) => setDelivery({ ...delivery, zip: e.target.value })}
                  placeholder="10012"
                />
              </div>
            </div>
          </>
        )}
      </div>

      <span className="section-title" style={{ display: 'block', marginTop: 22 }}>
        Payment
      </span>
      <div style={{ marginTop: 12 }}>
        {availableMethods.length === 0 ? (
          <div className="empty">
            <p>No payment methods are enabled. Contact the store owner.</p>
          </div>
        ) : (
          availableMethods.map((p) => (
            <div
              key={p.id}
              className={`pay-opt${method === p.id ? ' selected' : ''}`}
              onClick={() => setMethod(p.id)}
            >
              <span className="radio">
                <i />
              </span>
              <span className="pay-name">{p.name}</span>
              <span className="pay-sub">{p.sub}</span>
            </div>
          ))
        )}
      </div>

      <div className="panel">
        <div className="sum-row">
          <span>Subtotal</span>
          <span className="val">{formatMoney(subtotal, currency)}</span>
        </div>
        {needsAddress && (
          <div className="sum-row">
            <span>Shipping</span>
            {shipping === 0 ? (
              <span className="free">Free</span>
            ) : (
              <span className="val">{formatMoney(shipping, currency)}</span>
            )}
          </div>
        )}
        <div className="sum-row total">
          <span>Total</span>
          <span className="val">{formatMoney(total, currency)}</span>
        </div>
      </div>

      <div className="ctabar">
        <button
          type="button"
          className="btn-primary"
          disabled={submitting || !method}
          onClick={submit}
        >
          {submitting
            ? 'Placing order…'
            : method
              ? `Pay ${formatMoney(total, currency)}`
              : 'Select method'}
        </button>
      </div>
    </section>
  );
}

// Suppress unused import warnings in isolated TS builds.
export { PAYMENT_METHOD_LABEL };
