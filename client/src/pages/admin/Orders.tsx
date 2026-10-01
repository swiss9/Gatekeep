import { useEffect, useMemo, useState } from 'react';
import { api, formatMoney, type Order, type OrderItem, type OrderStatus } from '../../lib/api';
import { useToast } from '../../context/ToastContext';

const STATUSES: OrderStatus[] = [
  'Pending payment',
  'Paid',
  'Processing',
  'In transit',
  'Delivered',
  'Cancelled',
];
const FILTERS = ['All', 'Pending payment', 'Paid', 'Processing', 'Delivered', 'Cancelled'] as const;
type Filter = (typeof FILTERS)[number];

export function Orders() {
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [currency, setCurrency] = useState('$');
  const [filter, setFilter] = useState<Filter>('All');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = (f: Filter = filter) =>
    Promise.all([api.adminOrders(f === 'All' ? undefined : f), api.store()])
      .then(([o, s]) => {
        setOrders(o.orders);
        setItems(o.items);
        setCurrency(s.store.currency_symbol);
      })
      .catch((err: unknown) => toast(err instanceof Error ? err.message : 'Load failed'));

  useEffect(() => { void load(filter); /* eslint-disable-next-line */ }, [filter]);

  const itemsByOrder = useMemo(() => {
    const m = new Map<string, OrderItem[]>();
    items.forEach((it) => {
      const arr = m.get(it.order_id) ?? [];
      arr.push(it);
      m.set(it.order_id, arr);
    });
    return m;
  }, [items]);

  const changeStatus = async (order: Order, status: OrderStatus) => {
    try {
      await api.updateOrderStatus(order.id, status);
      await load();
      toast(status === 'Delivered' ? 'Delivered · digital goods sent' : 'Status updated');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Update failed');
    }
  };

  return (
    <>
      <div className="admin-tabs" style={{ marginTop: 16 }}>
        {FILTERS.map((f) => (
          <button key={f} type="button" className={`admin-tab${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>

      {orders.length === 0 ? (
        <div className="empty" style={{ marginTop: 12 }}><p>No orders yet.</p></div>
      ) : (
        orders.map((o) => {
          const orderItems = itemsByOrder.get(o.id) ?? [];
          const isOpen = expanded === o.id;
          return (
            <div className="order-card" key={o.id}>
              <div className="order-top" style={{ cursor: 'pointer' }} onClick={() => setExpanded(isOpen ? null : o.id)}>
                <span className="order-id">#{o.order_code}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {o.customer_name} · {formatMoney(o.total, currency)}
                </span>
              </div>

              {isOpen && (
                <>
                  <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
                    {o.customer_name}<br />
                    {o.customer_address}<br />
                    {o.customer_city}{o.customer_zip ? `, ${o.customer_zip}` : ''}
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    {orderItems.map((it) => (
                      <div key={it.id} className="sum-row">
                        <span>{it.product_name} × {it.quantity}</span>
                        <span className="val">{formatMoney(Number(it.product_price) * it.quantity, currency)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="order-bottom">
                <span className="order-date">
                  {new Date(o.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                <select
                  value={o.status}
                  onChange={(e) => changeStatus(o, e.target.value as OrderStatus)}
                  style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '4px 8px', background: 'var(--surface)', fontSize: 12, fontWeight: 600 }}
                >
                  {STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
