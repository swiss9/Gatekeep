import { useEffect, useMemo, useState } from 'react';
import {
  api,
  formatMoney,
  PAYMENT_METHOD_LABEL,
  type OrderItem,
  type OrderStatus,
  type OrderWithReceipt,
  type PaymentMethod,
} from '../../lib/api';
import { useToast } from '../../context/ToastContext';

const STATUSES: OrderStatus[] = [
  'Pending payment',
  'Paid',
  'Processing',
  'In transit',
  'Delivered',
  'Cancelled',
];

type Filter =
  | 'All'
  | 'Awaiting confirmation'
  | 'Pending payment'
  | 'Paid'
  | 'Processing'
  | 'In transit'
  | 'Delivered'
  | 'Cancelled';

const FILTERS: Filter[] = [
  'All',
  'Awaiting confirmation',
  'Pending payment',
  'Paid',
  'Processing',
  'In transit',
  'Delivered',
  'Cancelled',
];

export function Orders() {
  const toast = useToast();
  const [orders, setOrders] = useState<OrderWithReceipt[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [currency, setCurrency] = useState('$');
  const [filter, setFilter] = useState<Filter>('All');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [includeStale, setIncludeStale] = useState(false);

  const load = (f: Filter = filter, stale: boolean = includeStale) =>
    Promise.all([
      api.adminOrders(
        f === 'All' || f === 'Awaiting confirmation' ? undefined : f,
        stale,
      ),
      api.store(),
    ])
      .then(([o, s]) => {
        setOrders(o.orders);
        setItems(o.items);
        setCurrency(s.store.currency_symbol);
      })
      .catch((err: unknown) => toast(err instanceof Error ? err.message : 'Load failed'));

  useEffect(() => {
    void load(filter, includeStale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, includeStale]);

  const itemsByOrder = useMemo(() => {
    const m = new Map<string, OrderItem[]>();
    items.forEach((it) => {
      const arr = m.get(it.order_id) ?? [];
      arr.push(it);
      m.set(it.order_id, arr);
    });
    return m;
  }, [items]);

  const shown = useMemo(() => {
    if (filter === 'Awaiting confirmation') {
      return orders.filter(
        (o) => o.status === 'Pending payment' && !!o.payment_proof_submitted_at,
      );
    }
    return orders;
  }, [orders, filter]);

  const awaitingCount = orders.filter(
    (o) => o.status === 'Pending payment' && !!o.payment_proof_submitted_at,
  ).length;

  const changeStatus = async (order: OrderWithReceipt, status: OrderStatus) => {
    try {
      await api.updateOrderStatus(order.id, status);
      await load();
      toast(status === 'Delivered' ? 'Delivered · digital goods sent' : 'Status updated');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const confirmPaid = async (order: OrderWithReceipt) => {
    setBusy(order.id);
    try {
      await api.confirmOrderPaid(order.id);
      await load();
      toast('Order marked paid — buyer notified');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Confirm failed');
    } finally {
      setBusy(null);
    }
  };

  const simulatePaid = async (order: OrderWithReceipt) => {
    const ok = window.confirm(
      `Mark #${order.order_code} as paid WITHOUT any real payment?\n\n` +
        `Use this only to test the fulfillment pipeline. The order will be flagged as simulated.`,
    );
    if (!ok) return;
    setBusy(order.id);
    try {
      await api.simulateOrderPaid(order.id);
      await load();
      toast('Simulated — buyer notified, order flagged as test');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Simulate failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 16,
          padding: '10px 14px',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 12,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Show abandoned orders</div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
            Pending orders older than 2h with no proof submitted
          </div>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={includeStale}
            onChange={(e) => setIncludeStale(e.target.checked)}
          />
          <span className="track" />
          <span className="knob" />
        </label>
      </div>

      <div className="admin-tabs" style={{ marginTop: 14 }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`admin-tab${filter === f ? ' active' : ''}`}
            onClick={() => setFilter(f)}
            style={{ position: 'relative' }}
          >
            {f}
            {f === 'Awaiting confirmation' && awaitingCount > 0 && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 10,
                  fontWeight: 800,
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: '#B91C1C',
                  color: '#fff',
                }}
              >
                {awaitingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="empty" style={{ marginTop: 12 }}>
          <p>
            {filter === 'Awaiting confirmation'
              ? 'Nothing awaiting confirmation.'
              : includeStale
                ? 'No orders yet.'
                : 'No orders yet. Toggle "Show abandoned" to see stale pending orders.'}
          </p>
        </div>
      ) : (
        shown.map((o) => {
          const orderItems = itemsByOrder.get(o.id) ?? [];
          const isOpen = expanded === o.id;
          const methodLabel =
            PAYMENT_METHOD_LABEL[o.payment_method as PaymentMethod] ?? o.payment_method;
          const canConfirm = o.status === 'Pending payment';
          const isBusy = busy === o.id;

          const hasPhysicalItem = orderItems.some((it) => it.product_id !== null);
          const hasAddressText =
            o.customer_address && o.customer_address !== '—' && hasPhysicalItem;
          const hasCityText =
            o.customer_city && o.customer_city !== '—' && hasPhysicalItem;

          const hasProof =
            !!o.payment_proof_note ||
            !!o.payment_tx_hash ||
            !!o.payment_proof_signed_url;

          return (
            <div className="order-card" key={o.id}>
              <div
                className="order-top"
                style={{ cursor: 'pointer' }}
                onClick={() => setExpanded(isOpen ? null : o.id)}
              >
                <span className="order-id">
                  #{o.order_code}
                  {o.payment_simulated && (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 9.5,
                        fontWeight: 800,
                        letterSpacing: '0.08em',
                        padding: '2px 6px',
                        borderRadius: 999,
                        background: 'var(--yellow)',
                        color: '#78350F',
                        verticalAlign: 'middle',
                      }}
                    >
                      SIM
                    </span>
                  )}
                </span>
                <span
                  className={`status ${
                    o.status === 'Delivered' || o.status === 'Paid'
                      ? 'mint'
                      : o.status === 'Cancelled'
                        ? 'red'
                        : o.status === 'Pending payment'
                          ? 'yellow'
                          : 'blue'
                  }`}
                >
                  {o.status}
                </span>
              </div>

              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                {o.customer_name} · {formatMoney(o.total, currency)} · {methodLabel}
              </div>

              {isOpen && (
                <>
                  {(hasAddressText || hasCityText) && (
                    <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
                      {hasAddressText ? o.customer_address : null}
                      {hasAddressText && hasCityText ? <br /> : null}
                      {hasCityText ? o.customer_city : null}
                      {hasCityText && o.customer_zip ? `, ${o.customer_zip}` : ''}
                    </div>
                  )}

                  <div style={{ marginBottom: 12 }}>
                    {orderItems.map((it) => (
                      <div key={it.id} className="sum-row">
                        <span>
                          {it.product_name} × {it.quantity}
                        </span>
                        <span className="val">
                          {formatMoney(Number(it.product_price) * it.quantity, currency)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {hasProof && (
                    <div
                      style={{
                        border: '1px solid var(--line)',
                        borderRadius: 10,
                        padding: 12,
                        marginBottom: 12,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10.5,
                          fontWeight: 800,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          color: 'var(--muted)',
                          marginBottom: 8,
                        }}
                      >
                        Payment proof
                      </div>

                      {o.payment_tx_hash && (
                        <div
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 11.5,
                            wordBreak: 'break-all',
                            marginBottom: 6,
                          }}
                        >
                          tx: {o.payment_tx_hash}
                        </div>
                      )}

                      {o.payment_proof_note && (
                        <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
                          {o.payment_proof_note}
                        </div>
                      )}

                      {o.payment_proof_signed_url && (
                        <>
                          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                            Receipt image
                          </div>
                          <a
                            href={o.payment_proof_signed_url}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              display: 'block',
                              borderRadius: 10,
                              overflow: 'hidden',
                              border: '1px solid var(--line)',
                              background: 'var(--chip)',
                            }}
                          >
                            <img
                              src={o.payment_proof_signed_url}
                              alt="Receipt"
                              loading="lazy"
                              style={{
                                width: '100%',
                                maxHeight: 360,
                                objectFit: 'contain',
                                display: 'block',
                              }}
                            />
                          </a>
                          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                            Tap to open full size · link expires in 30 min
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  {canConfirm && (
                    <>
                      <button
                        type="button"
                        className="btn-primary"
                        style={{ height: 44, fontSize: 14, marginBottom: 8 }}
                        disabled={isBusy}
                        onClick={() => confirmPaid(o)}
                      >
                        {isBusy ? 'Working…' : 'Confirm paid'}
                      </button>
                      <button
                        type="button"
                        onClick={() => simulatePaid(o)}
                        disabled={isBusy}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          border: '1px dashed #B9BEC6',
                          borderRadius: 12,
                          background: 'transparent',
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: 'var(--muted)',
                          marginBottom: 10,
                        }}
                      >
                        Mark as simulated (for testing)
                      </button>
                    </>
                  )}
                </>
              )}

              <div className="order-bottom">
                <span className="order-date">
                  {new Date(o.created_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
                <select
                  value={o.status}
                  onChange={(e) => changeStatus(o, e.target.value as OrderStatus)}
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    padding: '4px 8px',
                    background: 'var(--surface)',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
