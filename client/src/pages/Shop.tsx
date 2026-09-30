import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Category, type Product, type StoreSettings } from '../lib/api';
import { haptic } from '../lib/telegram';
import { useCart } from '../context/CartContext';
import { useToast } from '../context/ToastContext';
import { useRouter } from '../App';
import { ProductCard } from '../components/ProductCard';
import { Banner } from '../components/Banner';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; store: StoreSettings; categories: Category[]; products: Product[] };

export function Shop() {
  const { navigate } = useRouter();
  const { items, wishlist, toggleWishlist, count } = useCart();
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [activeCat, setActiveCat] = useState<string>('All');
  const [query, setQuery] = useState('');
  const gridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.store(), api.categories(), api.products()])
      .then(([store, cats, prods]) => {
        if (cancelled) return;
        setState({
          kind: 'ready',
          store: store.store,
          categories: cats.categories,
          products: prods.products,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load.' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const categoryName = useCallback(
    (id: string | null): string => {
      if (state.kind !== 'ready' || !id) return '—';
      return state.categories.find((c) => c.id === id)?.name ?? '—';
    },
    [state],
  );

  const filtered = useMemo(() => {
    if (state.kind !== 'ready') return [];
    const q = query.trim().toLowerCase();
    return state.products.filter((p) => {
      if (!p.active) return false;
      if (activeCat !== 'All' && p.category_id !== activeCat) return false;
      if (q && !`${p.name} ${categoryName(p.category_id)}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [state, activeCat, query, categoryName]);

  const productsWithCat = useMemo(
    () => filtered.map((p) => ({ ...p, category_name: categoryName(p.category_id) })),
    [filtered, categoryName],
  );

  if (state.kind === 'loading')
    return <div className="screen active"><div className="center-state">Loading…</div></div>;
  if (state.kind === 'error')
    return (
      <div className="screen active">
        <div className="center-state">{state.message}</div>
      </div>
    );

  const { store, categories } = state;
  const currency = store.currency_symbol;

  const onBannerCta = () => {
    if (store.banner_cta_action === 'search') {
      document.getElementById('shop-search')?.focus();
      return;
    }
    setActiveCat('All');
    setQuery('');
    gridRef.current?.scrollIntoView({ block: 'start' });
  };

  return (
    <section className="screen active">
      <header className="shop-head">
        <div className="brand-row">
          <div className="brand">
            {store.store_name}
            {store.store_tagline && <em>{store.store_tagline}</em>}
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Cart"
            onClick={() => {
              if (items.length > 0) navigate({ name: 'checkout' });
              else toast('Your cart is empty');
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8h12l-1.2 12.2a1.5 1.5 0 0 1-1.5 1.3H8.7a1.5 1.5 0 0 1-1.5-1.3L6 8z" />
              <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
            </svg>
            <span className={`cart-badge${count === 0 ? ' hidden' : ''}`}>{count}</span>
          </button>
        </div>

        <div className="searchbar">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            id="shop-search"
            type="text"
            placeholder="Search products, categories…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="pills">
          <button
            type="button"
            className={`pill${activeCat === 'All' ? ' active' : ''}`}
            onClick={() => setActiveCat('All')}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`pill${activeCat === c.id ? ' active' : ''}`}
              onClick={() => setActiveCat(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      </header>

      {store.banner_enabled && <Banner settings={store} onCta={onBannerCta} />}

      <div className="sec-head" ref={gridRef}>
        <span className="section-title">Products</span>
        {(activeCat !== 'All' || query) && (
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setActiveCat('All');
              setQuery('');
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {productsWithCat.length === 0 ? (
        <div className="empty">
          <p>{query ? `No products match “${query}”.` : 'Nothing in this category yet.'}</p>
        </div>
      ) : (
        <div className="grid">
          {productsWithCat.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              currency={currency}
              saved={wishlist.has(p.id)}
              onOpen={() => {
                haptic('light');
                navigate({ name: 'product', id: p.id });
              }}
              onToggleSaved={() => {
                const wasSaved = wishlist.has(p.id);
                toggleWishlist(p.id);
                toast(wasSaved ? 'Removed from wishlist' : 'Saved to wishlist');
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
