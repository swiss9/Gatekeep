import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { ToastProvider } from './context/ToastContext';
import { Shop } from './pages/Shop';
import { ProductDetail } from './pages/ProductDetail';
import { Checkout } from './pages/Checkout';
import { OrderConfirmation } from './pages/OrderConfirmation';
import { Orders } from './pages/Orders';
import { Admin, type AdminTab } from './pages/Admin';
import { BottomNav, type Tab } from './components/BottomNav';

export type Route =
  | { name: 'shop' }
  | { name: 'product'; id: string }
  | { name: 'checkout' }
  | { name: 'confirmation'; orderCode: string }
  | { name: 'orders' }
  | { name: 'admin'; tab?: AdminTab };

type RouterCtx = { route: Route; navigate: (r: Route) => void; back: () => void };

const Ctx = createContext<RouterCtx | null>(null);

export function useRouter(): RouterCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRouter must be used inside RouterProvider');
  return ctx;
}

function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>({ name: 'shop' });

  useEffect(() => {
    window.history.replaceState({ name: 'shop' } satisfies Route, '');
    const onPop = (e: PopStateEvent) => {
      setRoute((e.state as Route | null) ?? { name: 'shop' });
      window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((r: Route) => {
    window.history.pushState(r, '');
    setRoute(r);
    window.scrollTo(0, 0);
  }, []);

  const back = useCallback(() => {
    window.history.back();
  }, []);

  return <Ctx.Provider value={{ route, navigate, back }}>{children}</Ctx.Provider>;
}

function Screens() {
  const { route } = useRouter();
  switch (route.name) {
    case 'shop':
      return <Shop />;
    case 'product':
      return <ProductDetail id={route.id} />;
    case 'checkout':
      return <Checkout />;
    case 'confirmation':
      return <OrderConfirmation orderCode={route.orderCode} />;
    case 'orders':
      return <Orders />;
    case 'admin':
      return <Admin initialTab={route.tab} />;
  }
}

function Nav() {
  const { route, navigate } = useRouter();
  const auth = useAuth();
  const role = auth.status === 'ready' ? auth.profile.role : null;

  const visible = route.name === 'shop' || route.name === 'orders' || route.name === 'admin';
  if (!visible) return null;

  const tab: Tab = route.name === 'admin' ? 'admin' : route.name === 'orders' ? 'orders' : 'shop';

  return (
    <BottomNav
      active={tab}
      role={role}
      onSelect={(next) => {
        if (next === 'shop') navigate({ name: 'shop' });
        else if (next === 'orders') navigate({ name: 'orders' });
        else navigate({ name: 'admin' });
      }}
    />
  );
}

function Shell() {
  const auth = useAuth();

  if (auth.status === 'loading') {
    return (
      <div className="app">
        <div className="center-state">Loading…</div>
      </div>
    );
  }

  if (auth.status === 'error') {
    return (
      <div className="app">
        <div className="center-state">{auth.message}</div>
      </div>
    );
  }

  return (
    <div className="app">
      <Screens />
      <Nav />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <CartProvider>
          <RouterProvider>
            <Shell />
          </RouterProvider>
        </CartProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
