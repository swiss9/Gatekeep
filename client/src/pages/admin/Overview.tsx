import { useEffect, useState } from 'react';
import { api, formatMoney, type Order } from '../../lib/api';

type Stats = { revenue: number; orderCount: number; adminCount: number; recentOrders: Order[] };

export function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [currency, setCurrency] = useState('$');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.overview(), api.store()])
      .then(([s, store]) => {
        if (cancelled) return;
        setStats(s);
        setCurrency(store.store.currency_symbol);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="empty" style={{ marginTop: 16 }}><p>{error}</p></div>;
  if (!stats) return <p className="muted" style={{ marginTop: 16 }}>Loading…</p>;

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="label">Revenue</div>
          <div className="value">{formatMoney(stats.revenue, currency)}</div>
          <div className="delta">all time</div>
        </div>
        <div className="stat">
          <div className="label">Orders</div>
          <div className="value">{stats.orderCount}</div>
          <div className="delta">non-cancelled</div>
        </div>
        <div className="stat">
          <div className="label">Admins</div>
          <div className="value">{stats.adminCount}</div>
          <div className="delta">incl. you</div>
        </div>
      </div>

      <span className="section-title" style={{ display: 'block', marginTop: 26 }}>
        Recent orders
      </span>
      {stats.recentOrders.length === 0 ? (
        <div className="empty" style={{ marginTop: 12 }}>
          <p>No orders yet.</p>
        </div>
      ) : (
        <div className="inv-list">
          {stats.recentOrders.map((o) => (
            <div className="inv-row" key={o.id}>
              <div className="inv-info">
                <div className="inv-name">#{o.order_code}</div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                  {o.customer_name} · {o.customer_city}
                </div>
              </div>
              <span className="inv-stock" style={{ width: 'auto' }}>
                {formatMoney(o.total, currency)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
