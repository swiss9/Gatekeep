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

  const load = (f: Filter = filter) =>
    Promise.all([
      api.adminOrders(f === 'All' || f === 'Awaiting confirmation' ? undefined : f),
      api.store(),
    ])
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
      <div className="admin-tabs" style={{ marginTop: 16 }}>
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
          <p>{filter === 'Awaiting confirmation' ? 'Nothing awaiting confirmation.' : 'No orders yet.'}</p>
        </div>
      ) : (
        shown.map((o) => {
          const orderItems = itemsByOrder.get(o.id) ?? [];
          const isOpen = expanded === o.id;
          const methodLabel = PAYMENT_METHOD_LABEL[o.payment_method as PaymentMethod] ?? o.payment_method;
          const canConfirm = o.status === 'Pending payment';
          const isBusy = busy === o.id;

          // Hide address block for orders that contain no physical items.
          const hasPhysicalItem = orderItems.some((it) => it.product_id !== null);
          const hasAddressText =
            o.customer_address && o.customer_address !== '—' && hasPhysicalItem;
          const hasCityText = o.customer_city && o.customer_city !== '—' && hasPhysicalItem;

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

              <div className="muted" style={{ fontSize: 12, marginBottom: 
