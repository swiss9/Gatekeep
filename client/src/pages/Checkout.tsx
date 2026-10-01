import { useEffect, useState } from 'react';
import { api, formatMoney, type PaymentMethod } from '../lib/api';
import { haptic, openTelegramLink } from '../lib/telegram';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useToast } from '../context/ToastContext';
import { useRouter } from '../App';
import { PastelThumb } from '../components/PastelThumb';

type Delivery = { name: string; address: string; city: string; zip: string };
type FieldErrors = Partial<Record<keyof Delivery, boolean>>;

const PAYMENTS: { id: PaymentMethod; name: string; sub: string }[] = [
  { id: 'card', name: 'Credit Card', sub: '•••• 4242' },
  { id: 'apple', name: 'Apple Pay', sub: 'instant' },
  { id: 'cod', name: 'Cash on Delivery', sub: 'on delivery' },
];

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
  const [payment, setPayment] = useState<PaymentMethod>('card');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [store, setStore] = useState<{
    currency_symbol: string;
    shipping_threshold: number;
    shipping_cost: number;
    payment_provider: string;
  } | null>(null);

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

  const currency = store?.currency_symbol ?? '$';
  const threshold = store?.shipping_threshold ?? 60;
  const shipCost = store?.shipping_cost ?? 6;

  const subtotal = items.reduce((n, i) => n + i.product.price * i.quantity, 0);
  const shipping = subtotal === 0 || subtotal >= threshold ? 0 : shipCost;
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
    const nextErrors: FieldErrors = {
      name: !delivery.name.trim(),
      address: !delivery.address.trim(),
      city: !delivery.city.trim(),
    };
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      toast('Please fill in delivery details');
      return;
    }
    setSubmitting(true);
    try {
      const { order, payment_url } = await api.createOrder({
        items: items.map((i) => ({ product_id: i.product.id, quantity: i.quantity })),
        delivery: {
          name: delivery.name.trim(),
          address: delivery.address.trim(),
          city: delivery.city.trim(),
          zip: delivery.zip.trim() || undefined,
        },
        payment_method: payment,
      });
      haptic('heavy');
      clear();

      if (payment_url) {
        openTelegramLink(payment_url);
      }

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
        Delivery
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
      </div>

      <span className="section-title" style={{ display: 'block', marginTop: 22 }}>
        Payment
      </span>
      <div style={{ marginTop: 12 }}>
        {PAYMENTS.map((p) => (
          <div
            key={p.id}
            className={`pay-opt${payment === p.id ? ' selected' : ''}`}
            onClick={() => setPayment(p.id)}
          >
            <span className="radio">
              <i />
            </span>
            <span className="pay-name">{p.name}</span>
            <span className="pay-sub">{p.sub}</span>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="sum-row">
          <span>Subtotal</span>
          <span className="val">{formatMoney(subtotal, currency)}</span>
        </div>
        <div className="sum-row">
          <span>Shipping</span>
          {shipping === 0 ? (
            <span className="free">Free</span>
          ) : (
            <span className="val">{formatMoney(shipping, currency)}</span>
          )}
        </div>
        <div className="sum-row total">
          <span>Total</span>
          <span className="val">{formatMoney(total, currency)}</span>
        </div>
      </div>

      <div className="ctabar">
        <button type="button" className="btn-primary" disabled={submitting} onClick={submit}>
          {submitting ? 'Placing order…' : `Pay ${formatMoney(total, currency)}`}
        </button>
      </div>
    </section>
  );
}
