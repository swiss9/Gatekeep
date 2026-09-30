/**
 * Domain types shared across the server.
 * Mirrors the Postgres schema in supabase/migrations/001_initial.sql.
 */

export type Role = 'customer' | 'admin' | 'superadmin';

export type Profile = {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  role: Role;
  invited_by: string | null;
  created_at: string;
};

export type StoreSettings = {
  id: 1;
  store_name: string;
  store_tagline: string;
  currency_symbol: string;
  shipping_threshold: number;
  shipping_cost: number;
  banner_enabled: boolean;
  banner_eyebrow: string;
  banner_title: string;
  banner_subtitle: string;
  banner_cta: string;
  banner_cta_action: 'all' | 'category' | 'search';
  banner_color: 'mint' | 'blue' | 'pink' | 'yellow' | 'neutral';
  updated_at: string;
};

export type Category = {
  id: string;
  name: string;
  position: number;
  created_at: string;
};

export type Product = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category_id: string | null;
  image_url: string | null;
  pastel_color: 'blue' | 'pink' | 'yellow' | 'mint';
  stock: number;
  active: boolean;
  rating: number;
  review_count: number;
  created_at: string;
  updated_at: string;
};

export type OrderStatus = 'Processing' | 'In transit' | 'Delivered' | 'Cancelled';

export type Order = {
  id: string;
  order_code: string;
  user_id: string;
  customer_name: string;
  customer_address: string;
  customer_city: string;
  customer_zip: string | null;
  status: OrderStatus;
  payment_method: string;
  subtotal: number;
  shipping: number;
  total: number;
  created_at: string;
};

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  product_price: number;
  quantity: number;
  pastel_color: string | null;
};

export type AdminInvite = {
  id: string;
  token: string;
  created_by: string;
  grants_role: 'admin' | 'superadmin';
  expires_at: string;
  used_by: string | null;
  used_at: string | null;
  created_at: string;
};
