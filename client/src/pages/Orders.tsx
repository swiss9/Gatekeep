import { useEffect, useMemo, useState } from 'react';
import { api, formatMoney, type Order, type OrderItem, type OrderStatus, type StoreSettings } from '../lib/api';
import { PastelThumb } from '../components/PastelThumb';

const STATUS_CLASS: Record<OrderStatus, string> = {
  Delivered: 'mint',
  'In transit': 'blue',
  Processing: 'yellow',
  Cancelled: 'red',
};

const FILTERS = ['All', 'Active', 'Delivered'] as const;
type Filter = (typeof FILTERS)[number];

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; orders: Order[]; items: OrderItem[]; store: StoreSettings };

export function Orders() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [filter, setFilter] = useState<Filter>('All');

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.myOrders(), api.store()])
      .then(([o, s]) => {
        if (cancelled) return;
        setState({ kind: 'ready', orders: o.orders, items: o.items, store: s.store });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load.' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (state.kind !== 'ready') return [];
    if (filter === 'Active') return state.orders.filter((o) => o.status !== 'Delivered' && o.status !== 'Cancelled');
    if (filter === 'Delivered') return state.orders.filter((o) => o.status === 'Delivered');
    return state.orders;
  }, [state, filter]);

  if (state.kind === 'loading')
    return <div className="screen active"><div className="center-state">Loading…</div></div>;
  if (state.kind === 'error')
    return (
      <div className="screen active">
        <div className="center-state">{state.message}</div>
      </div>
    );

  const currency = state.store.currency_symbol;
  const itemsByOrder = new Map<string, OrderItem[]>();
  state.items.forEach((it) => {
    const arr = itemsByOrder.get(it.order_id) ?? [];
    arr.push(it);
    itemsByOrder.set(it.order_id, arr);
  });

  const activeCount = state.orders.filter((o) => o.status !== 'Delivered' && o.status !== 'Cancelled').length;

  return (
    <section className="screen active">
      <div className="page-head">
        <h1 className="page-title h-display">Orders</h1>
        <p className="page-sub">
          {state.orders.length} orders · {activeCount} active
        </p>
      </div>

      <div className="pills" style={{ paddingTop: 10 }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`pill${filter === f ? ' active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty" style={{ marginTop: 12 }}>
          <p>No orders here yet.</p>
        </div>
      ) : (
        filtered.map((o) => {
          const items = itemsByOrder.get(o.id) ?? [];
          const count = items.reduce((n, i) => n + i.quantity, 0);
          return (
            <div className="order-card" key={o.id}>
              <div className="order-top">
                <span className="order-id">#{o.order_code}</span>
                <span className={`status ${STATUS_CLASS[o.status] ?? 'mint'}`}>{o.status}</span>
              </div>
              <div className="order-items">
                {items.slice(0, 4).map((it) => (
                  <div className="order-thumb" key={it.id} style={{ background: '#EEEFF1' }}>
                    <span className="initial">{it.product_name.charAt(0).toUpperCase()}</span>
                  </div>
                ))}
                <span className="order-more">
                  {count} {count === 1 ? 'item' : 'items'}
                </span>
              </div>
              <div className="order-bottom">
                <span className="order-date">
                  {new Date(o.created_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
                <span className="order-total">{formatMoney(o.total, currency)}</span>
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
