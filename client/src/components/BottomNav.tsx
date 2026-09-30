import type { Role } from '../lib/api';

export type Tab = 'shop' | 'orders' | 'admin';

type Props = {
  active: Tab;
  role: Role | null;
  onSelect: (tab: Tab) => void;
};

export function BottomNav({ active, role, onSelect }: Props) {
  const showAdmin = role === 'admin' || role === 'superadmin';

  return (
    <nav className="bnav">
      <button
        type="button"
        className={`bnav-btn${active === 'shop' ? ' active' : ''}`}
        onClick={() => onSelect('shop')}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8h12l-1.2 12.2a1.5 1.5 0 0 1-1.5 1.3H8.7a1.5 1.5 0 0 1-1.5-1.3L6 8z" />
          <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
        </svg>
        <span>Shop</span>
      </button>

      <button
        type="button"
        className={`bnav-btn${active === 'orders' ? ' active' : ''}`}
        onClick={() => onSelect('orders')}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7z" />
          <path d="M4 8.5 12 13l8-4.5M12 13v7" />
        </svg>
        <span>Orders</span>
      </button>

      {showAdmin && (
        <button
          type="button"
          className={`bnav-btn${active === 'admin' ? ' active' : ''}`}
          onClick={() => onSelect('admin')}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12M20 17h0" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="10" cy="12" r="2" />
            <circle cx="18" cy="17" r="2" />
          </svg>
          <span>Admin</span>
        </button>
      )}
    </nav>
  );
}
