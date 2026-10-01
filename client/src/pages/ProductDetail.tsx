import { useEffect, useState } from 'react';
import { api, formatMoney, type ProductWithCategory, type StoreSettings } from '../lib/api';
import { haptic } from '../lib/telegram';
import { useCart } from '../context/CartContext';
import { useToast } from '../context/ToastContext';
import { useRouter } from '../App';
import { PastelThumb } from '../components/PastelThumb';
import { QuantityStepper } from '../components/QuantityStepper';

type Props = { id: string };

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; product: ProductWithCategory; store: StoreSettings };

export function ProductDetail({ id }: Props) {
  const { back, navigate } = useRouter();
  const { wishlist, toggleWishlist, replace } = useCart();
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [qty, setQty] = useState(1);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.product(id), api.store(), api.categories()])
      .then(([p, s, c]) => {
        if (cancelled) return;
        const categoryName = c.categories.find((cat) => cat.id === p.product.category_id)?.name ?? '—';
        setState({
          kind: 'ready',
          product: { ...p.product, category_name: categoryName },
          store: s.store,
        });
        setQty(1);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load.' });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.kind === 'loading')
    return <div className="screen cta-screen active"><div className="center-state">Loading…</div></div>;
  if (state.kind === 'error')
    return (
      <div className="screen cta-screen active">
        <div className="center-state">{state.message}</div>
      </div>
    );

  const { product, store } = state;
  const currency = store.currency_symbol;
  const isDigital = product.delivery_type === 'digital';
  const isNone = product.delivery_type === 'none';
  const inStock = isNone || product.stock > 0;
  const maxQty = isNone ? 99 : Math.min(product.stock, 9);
  const saved = wishlist.has(product.id);

  return (
    <section className="screen cta-screen active">
      <div className="topbar">
        <button type="button" className="icon-btn" aria-label="Back" onClick={back}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="m14.5 6-6 6 6 6" />
          </svg>
        </button>
        <span className="topbar-title">Product Detail</span>
        <button
          type="button"
          className={`icon-btn${saved ? ' heart-on' : ''}`}
          aria-label="Save"
          onClick={() => {
            toggleWishlist(product.id);
            toast(saved ? 'Removed from wishlist' : 'Saved to wishlist');
          }}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill={saved ? '#111111' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M12 20.5s-7.5-4.7-9.3-9.2C1.3 7.7 3.6 4.5 6.9 4.5c2 0 3.6 1.1 4.6 2.7.2.4.4.4.6 0 1-1.6 2.6-2.7 4.6-2.7 3.3 0 5.6 3.2 4.2 6.8-1.8 4.5-9.4 9.2-9.4 9.2z" />
          </svg>
        </button>
      </div>

      <div className="detail-thumb">
        <PastelThumb product={product} className="thumb" />
      </div>

      <span className="p-cat">{product.category_name}</span>
      <div className="detail-head">
        <h2 className="detail-name h-display">{product.name}</h2>
        <span className="detail-price">{formatMoney(product.price, currency)}</span>
      </div>
      <div className="detail-rating">
        ★ {Number(product.rating).toFixed(1)} · {product.review_count} reviews
      </div>
      <p className="detail-desc">{product.description || 'No description yet.'}</p>

      <div className="stock-line">
        <span className={`dot${inStock ? '' : ' out'}`} />
        <span className="muted">
          {!inStock
            ? 'Out of stock'
            : isDigital
              ? 'Instant download after purchase'
              : isNone
                ? 'Available for order'
                : product.stock <= 10
                  ? `Only ${product.stock} left in stock`
                  : 'In stock · ships within 24h'}
        </span>
      </div>

      {!isNone && (
        <div className="qty-row">
          <span className="section-title">Quantity</span>
          <QuantityStepper value={qty} min={1} max={Math.max(1, maxQty)} onChange={setQty} />
        </div>
      )}

      {store.perks_enabled && !isDigital && (
        <div className="perks">
          <div className="perk">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7h11v10H3zM14 10h4l3 3v4h-7z" />
              <circle cx="7" cy="17.5" r="1.8" />
              <circle cx="17.5" cy="17.5" r="1.8" />
            </svg>
            {store.perk_1_text}
          </div>
          <div className="perk">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 9a8 8 0 0 1 14.9-2M20 15a8 8 0 0 1-14.9 2" />
              <path d="M18.5 3.5V7H15M5.5 20.5V17H9" />
            </svg>
            {store.perk_2_text}
          </div>
          <div className="perk">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 4.5 6v5c0 4.6 3.2 8.2 7.5 10 4.3-1.8 7.5-5.4 7.5-10V6L12 3z" />
              <path d="m9 11.5 2.2 2.2L15.5 9" />
            </svg>
            {store.perk_3_text}
          </div>
        </div>
      )}

      <div className="ctabar">
        <button
          type="button"
          className="btn-primary"
          disabled={!inStock}
          onClick={() => {
            if (!inStock) return;
            haptic('medium');
            replace(product, isNone ? 1 : Math.min(qty, product.stock || 1));
            navigate({ name: 'checkout' });
          }}
        >
          {inStock
            ? isDigital
              ? `Buy Now · ${formatMoney(product.price, currency)}`
              : `Buy Now · ${formatMoney(product.price * qty, currency)}`
            : 'Out of stock'}
        </button>
      </div>
    </section>
  );
}
