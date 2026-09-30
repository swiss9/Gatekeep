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

export type PastelColor = 'blue' | 'pink' | 'yellow' | 'mint';

export type Product = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category_id: string | null;
  image_url: string | null;
  pastel_color: PastelColor;
  stock: number;
  active: boolean;
  rating: number;
  review_count: number;
  created_at: string;
  updated_at: string;
};

export type ProductWithCategory = Product & { category_name: string };

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

export type PaymentMethod = 'card' | 'apple' | 'cod';

export type CreateOrderBody = {
  items: { product_id: string; quantity: number }[];
  delivery: { name: string; address: string; city: string; zip?: string };
  payment_method: PaymentMethod;
};

export type ProductWriteBody = {
  name?: string;
  description?: string;
  price?: number;
  category_id?: string | null;
  image_url?: string | null;
  pastel_color?: PastelColor;
  stock?: number;
  active?: boolean;
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = import.meta.env.VITE_API_URL.replace(/\/+$/, '');
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL.replace(/\/+$/, '');
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let token: string | null = null;

export function setToken(next: string | null): void {
  token = next;
}

export function getToken(): string | null {
  return token;
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown; auth?: boolean };

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  if (opts.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (opts.auth !== false && token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : res.statusText;
    throw new ApiError(res.status, message);
  }

  return data as T;
}

export const api = {
  validate: (initData: string, startParam?: string) =>
    request<{ token: string; profile: Profile }>('/api/auth/validate', {
      method: 'POST',
      body: { initData, start_param: startParam },
      auth: false,
    }),

  store: () => request<{ store: StoreSettings }>('/api/store', { auth: false }),

  categories: () => request<{ categories: Category[] }>('/api/categories', { auth: false }),

  products: (opts: { all?: boolean } = {}) =>
    request<{ products: Product[] }>(`/api/products${opts.all ? '?all=1' : ''}`, {
      auth: opts.all === true,
    }),

  product: (id: string) => request<{ product: Product }>(`/api/products/${id}`, { auth: false }),

  myOrders: () => request<{ orders: Order[]; items: OrderItem[] }>('/api/orders/mine'),

  createOrder: (body: CreateOrderBody) =>
    request<{ order: Order }>('/api/orders', { method: 'POST', body }),

  updateSettings: (patch: Partial<Omit<StoreSettings, 'id' | 'updated_at'>>) =>
    request<{ store: StoreSettings }>('/api/admin/settings', { method: 'PATCH', body: patch }),

  createCategory: (body: { name: string; position?: number }) =>
    request<{ category: Category }>('/api/admin/categories', { method: 'POST', body }),

  updateCategory: (id: string, patch: { name?: string; position?: number }) =>
    request<{ category: Category }>(`/api/admin/categories/${id}`, { method: 'PATCH', body: patch }),

  deleteCategory: (id: string) =>
    request<{ ok: true }>(`/api/admin/categories/${id}`, { method: 'DELETE' }),

  createProduct: (body: ProductWriteBody & { name: string; price: number }) =>
    request<{ product: Product }>('/api/admin/products', { method: 'POST', body }),

  updateProduct: (id: string, patch: ProductWriteBody) =>
    request<{ product: Product }>(`/api/admin/products/${id}`, { method: 'PATCH', body: patch }),

  deleteProduct: (id: string) =>
    request<{ ok: true }>(`/api/admin/products/${id}`, { method: 'DELETE' }),

  adminOrders: (status?: string) =>
    request<{ orders: Order[]; items: OrderItem[] }>(
      `/api/admin/orders${status && status !== 'All' ? `?status=${encodeURIComponent(status)}` : ''}`,
    ),

  updateOrderStatus: (id: string, status: OrderStatus) =>
    request<{ order: Order }>(`/api/admin/orders/${id}`, { method: 'PATCH', body: { status } }),

  overview: () =>
    request<{
      revenue: number;
      orderCount: number;
      adminCount: number;
      recentOrders: Order[];
    }>('/api/admin/overview'),

  team: () => request<{ team: Profile[] }>('/api/admin/team'),

  removeMember: (id: string) => request<{ ok: true }>(`/api/admin/team/${id}`, { method: 'DELETE' }),

  setMemberRole: (id: string, role: 'admin' | 'superadmin') =>
    request<{ profile: Profile }>(`/api/admin/team/${id}/role`, { method: 'PATCH', body: { role } }),

  transferOwnership: (target_id: string) =>
    request<{ ok: true }>('/api/admin/team/transfer', { method: 'POST', body: { target_id } }),

  createInvite: (grants_role: 'admin' | 'superadmin') =>
    request<{ invite: AdminInvite; token: string }>('/api/admin/invites', {
      method: 'POST',
      body: { grants_role },
    }),

  listInvites: () => request<{ invites: AdminInvite[] }>('/api/admin/invites'),

  revokeInvite: (id: string) =>
    request<{ ok: true }>(`/api/admin/invites/${id}`, { method: 'DELETE' }),
};

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export async function uploadProductImage(file: File): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new ApiError(400, 'Unsupported image type (use JPG, PNG, WebP or GIF).');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ApiError(400, 'Image too large (max 5MB).');
  }
  if (!token) throw new ApiError(401, 'Not authenticated.');

  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${crypto.randomUUID()}.${ext}`;
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/products/${path}`;

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: ANON_KEY,
      'x-upsert': 'false',
    },
    body: file,
  });

  if (!res.ok) throw new ApiError(res.status, 'Image upload failed.');
  return `${SUPABASE_URL}/storage/v1/object/public/products/${path}`;
}

export function formatMoney(value: number | string, symbol: string): string {
  const n = typeof value === 'string' ? Number(value) : value;
  const r = Math.round(n * 100) / 100;
  return `${symbol}${r % 1 === 0 ? r.toString() : r.toFixed(2)}`;
}
