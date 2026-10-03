import { useEffect, useMemo, useState } from 'react';
import {
  api,
  formatMoney,
  type Order,
  type OrderItem,
  type OrderStatus,
  type StoreSettings,
} from '../lib/api';
import { useToast } from '../context/ToastContext';

const STATUS_CLASS: Record<OrderStatus, string> = {
  'Pending payment': 'yellow',
  Paid: 'mint',
  Processing: 'blue',
  'In transit': 'blue',
  Delivered: 'mint',
  Cancelled: 'red',
};

const FILTERS = ['All', 'Active', 'Delivered'] as const;
type Filter = (typeof FILTERS)[number];

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; orders: Order[]; items: OrderItem[]; store: StoreSettings };

type Download = { product_name: string; file_index: number; file_total: number; signed_url: string };

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function Orders() {
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [filter, setFilter] = useState<Filter>('All');
  const [downloadsFor, setDownloadsFor] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<Download[] | null>(null);
  const [loadingDownloads, setLoadingDownloads] = useState(false);

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
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (state.kind !== 'ready') return [];
    if (filter === 'Active')
      return state.orders.filter((o) => o.status !== 'Delivered' && o.status !== 'Cancelled');
    if (filter === 'Delivered') return state.orders.filter((o) => o.status === 'Delivered');
    return state.orders;
  }, [state, filter]);

  const openDownloads = async (order: Order) => {
    if (downloadsFor === order.id) {
      setDownloadsFor(null);
      setDownloads(null);
      return;
    }
    setLoadingDownloads(true);
    setDownloadsFor(order.id);
    try {
      const { downloads: dls } = await api.orderDownloads(order.id);
      setDownloads(dls);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No downloads');
      setDownloadsFor(null);
      setDownloads(null);
    } finally {
      setLoadingDownloads(false);
    }
  };

  if (state.kind === 'loading')
    return <div className="screen active"><div className="center-state">Loading…</div></div>;
  if (state.kind === 'error')
    return <div className="screen active"><div className="center-state">{state.message}</div></div>;

  const currency = state.store.currency_symbol;
  const itemsByOrder = new Map<string, OrderItem[]>();
  state.items.forEach((it) => {
    const arr = itemsByOrder.get(it.order_id) ?? [];
    arr.push(it);
    itemsByOrder.set(it.order_id, arr);
  });

  const activeCount = state.orders.filter(
    (o) => o.status !== 'Delivered' && o.status !== 'Cancelled',
  ).length;

  return (
    <section className="screen active">
      <div className="page-head">
        <h1 className="page-title h-display">Orders</h1>
        <p className="page-sub">{state.orders.length} orders · {activeCount} active</p>
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
          const isAwaitingConfirm = o.status === 'Pending payment' && !!o.payment_proof_submitted_at;
          const canDownload = o.status !== 'Pending payment' && o.status !== 'Cancelled';
          const shown = downloadsFor === o.id ? downloads : null;

          return (
            <div className="order-card" key={o.id}>
              <div className="order-top">
                <span className="order-id">#{o.order_code}</span>
                <span className={`status ${STATUS_CLASS[o.status] ?? 'mint'}`}>
                  {isAwaitingConfirm ? 'Awaiting confirmation' : o.status}
                </span>
              </div>
              <div className="order-items">
                {items.slice(0, 4).map((it) => (
                  <div className="order-thumb" key={it.id} style={{ background: '#EEEFF1' }}>
                    <span className="initial">{it.product_name.charAt(0).toUpperCase()}</span>
                  </div>
                ))}
                <span className="order-more">{count} {count === 1 ? 'item' : 'items'}</span>
              </div>
              <div className="order-bottom">
                <span className="order-date" style={{ fontSize: 11.5 }}>
                  {formatDateTime(o.created_at)}
                </span>
                <span className="order-total">{formatMoney(o.total, currency)}</span>
              </div>

              {canDownload && (
                <button
                  type="button"
                  className="btn-primary"
                  style={{ height: 42, fontSize: 13, marginTop: 10 }}
                  disabled={loadingDownloads && downloadsFor === o.id}
                  onClick={() => openDownloads(o)}
                >
                  {downloadsFor === o.id ? 'Hide downloads' : 'Show downloads'}
                </button>
              )}

              {shown && shown.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {shown.map((d, i) => (
                    <div
                      key={i}
                      style={{
                        border: '1px solid var(--line)',
                        borderRadius: 10,
                        padding: '10px 12px',
                        marginTop: 8,
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                        {d.product_name}
                        {d.file_total > 1 ? ` · ${d.file_index + 1} of ${d.file_total}` : ''}
                      </div>
                      <a href={d.signed_url} target="_blank" rel="noreferrer" className="link-btn">
                        Download (24h link)
                      </a>
                    </div>
                  ))}
                </div>
              )}

              {shown && shown.length === 0 && (
                <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  No downloadable items in this order.
                </p>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
