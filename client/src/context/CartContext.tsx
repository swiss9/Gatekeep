import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Product } from '../lib/api';

export type CartItem = { product: Product; quantity: number };

type CartState = {
  items: CartItem[];
  wishlist: ReadonlySet<string>;
  count: number;
  subtotal: number;
  replace: (product: Product, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  toggleWishlist: (productId: string) => void;
};

const CartCtx = createContext<CartState | null>(null);

export function useCart(): CartState {
  const ctx = useContext(CartCtx);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [wishlist, setWishlist] = useState<Set<string>>(() => new Set());

  const replace = useCallback((product: Product, quantity: number) => {
    setItems([{ product, quantity }]);
  }, []);

  const remove = useCallback((productId: string) => {
    setItems((prev) => prev.filter((i) => i.product.id !== productId));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const toggleWishlist = useCallback((productId: string) => {
    setWishlist((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }, []);

  const value = useMemo<CartState>(() => {
    const count = items.reduce((n, i) => n + i.quantity, 0);
    const subtotal = items.reduce((n, i) => n + i.product.price * i.quantity, 0);
    return { items, wishlist, count, subtotal, replace, remove, clear, toggleWishlist };
  }, [items, wishlist, replace, remove, clear, toggleWishlist]);

  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}
