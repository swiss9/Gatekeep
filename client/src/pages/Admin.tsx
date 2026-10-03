import { useState } from 'react';
import { Overview } from './admin/Overview';
import { Products } from './admin/Products';
import { Categories } from './admin/Categories';
import { Orders } from './admin/Orders';
import { Team } from './admin/Team';
import { Settings } from './admin/Settings';

export type AdminTab = 'overview' | 'products' | 'categories' | 'orders' | 'team' | 'settings';

const TABS: { id: AdminTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'products', label: 'Products' },
  { id: 'categories', label: 'Categories' },
  { id: 'orders', label: 'Orders' },
  { id: 'team', label: 'Team' },
  { id: 'settings', label: 'Settings' },
];

export function Admin({ initialTab = 'overview' }: { initialTab?: AdminTab }) {
  const [tab, setTab] = useState<AdminTab>(initialTab);

  return (
    <section className="screen active">
      <div className="page-head">
        <h1 className="page-title h-display">Admin</h1>
        <p className="page-sub">Store overview</p>
      </div>

      <div className="admin-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`admin-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview />}
      {tab === 'products' && <Products />}
      {tab === 'categories' && <Categories />}
      {tab === 'orders' && <Orders />}
      {tab === 'team' && <Team />}
      {tab === 'settings' && <Settings />}
    </section>
  );
}
