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
const FILTERS = [
  'All',
  'Pending payment',
  'Paid',
  'Processing',
  'In transit',
  'Delivered',
  'Cancelled',
] as const;
type Filter = (typeof FILTERS)[number];

export function Orders() {
  const toast = useToast();
  const [orders, setOrders] = useState<OrderWithReceipt[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [currency, setCurrency] = useState('$');
  const [filter, setFilter] = useState<Filter>('All');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = (f: Filter = filter) =>
    Promise.all([api.adminOrders(f === 'All' ? undefined : f), api.store()])
      .then(([o, s]) => {
        setOrders(o.orders);
        setItems(o.items);
        setCurrency(s.store.currency_symbol);
      })
      .catch((err: unknown) => toast(err instanceof Error ? err.message : 'Load failed'));

  useEffect(() => {
    void load(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const itemsByOrder = useMemo(() => {
    const m = new Map<string, OrderItem[]>();
    items.forEach((it) => {
      const arr = m.get(it.order_id) ?? [];
      arr.push(it);
      m.set(it.order_id, arr);
    });
    return m;
  }, [items]);

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
    setConfirming(order.id);
    try {
      await api.confirmOrderPaid(order.id);
      await load();
      toast('Order marked paid — buyer notified');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Confirm failed');
    } finally {
      setConfirming(null);
    }
  };

  return (
    <>
      <div className="admin-tabs" style={{ marginTop: 16 }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`admin-tab${filter === f ? ' active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      {orders.length === 0 ? (
        <div className="empty" style={{ marginTop: 12 }}>
          <p>No orders yet.</p>
        </div>
      ) : (
        orders.map((o) => {
          const orderItems = itemsByOrder.get(o.id) ?? [];
          const isOpen = expanded === o.id;
          const methodLabel =
            PAYMENT_METHOD_LABEL[o.payment_method as PaymentMethod] ?? o.payment_method;
          const canConfirm = o.status === 'Pending payment';

          const hasAddress =
            (o.customer_address && o.customer_address !== '—') ||
            (o.customer_city && o.customer_city !== '—');

          return (
            <div className="order-card" key={o.id}>
              <div
                className="order-top"
                style={{ cursor: 'pointer' }}
                onClick={() => setExpanded(isOpen ? null : o.id)}
              >
                <span className="order-id">#{o.order_code}</span>
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
                  {hasAddress && (
                    <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
                      {o.customer_address && o.customer_address !== '—'
                        ? o.customer_address
                        : null}
                      {o.customer_address &&
                        o.customer_address !== '—' &&
                        o.customer_city &&
                        o.customer_city !== '—' && <br />}
                      {o.customer_city && o.customer_city !== '—'
                        ? o.customer_city
                        : null}
                      {o.customer_city &&
                        o.customer_city !== '—' &&
                        o.customer_zip
                        ? `, ${o.customer_zip}`
                        : ''}
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

                  {(o.payment_proof_note ||
                    o.payment_tx_hash ||
                    o.payment_proof_signed_url) && (
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
                          marginBottom: 6,
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
                        <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
                          {o.payment_proof_note}
                        </div>
                      )}
                      {o.payment_proof_signed_url && (
                        <a
                          href={o.payment_proof_signed_url}
                          target="_blank"
                          rel="noreferrer"
                          className="link-btn"
                          style={{ display: 'inline-block' }}
                        >
                          View receipt image
                        </a>
                      )}
                    </div>
                  )}

                  {canConfirm && (
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ height: 44, fontSize: 14, marginBottom: 10 }}
                      disabled={confirming === o.id}
                      onClick={() => confirmPaid(o)}
                    >
                      {confirming === o.id ? 'Confirming…' : 'Confirm paid'}
                    </button>
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
