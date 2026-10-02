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

export type PaymentProvider =
  | 'manual'
  | 'cod'
  | 'bank'
  | 'crypto'
  | 'stars'
  | 'stripe';

export type StoreSettings = {
  id: 1;
  store_name: string;
  store_tagline: string;
  currency_symbol: string;
  currency_code: string;
  shipping_threshold: number;
  shipping_cost: number;
  banner_enabled: boolean;
  banner_eyebrow: string;
  banner_title: string;
  banner_subtitle: string;
  banner_cta: string;
  banner_cta_action: 'all' | 'category' | 'search';
  banner_color: 'mint' | 'blue' | 'pink' | 'yellow' | 'neutral';
  payment_provider: PaymentProvider;
  payment_url: string;
  payment_ton_address: string;
  perks_enabled: boolean;
  perk_1_text: string;
  perk_2_text: string;
  perk_3_text: string;
  stars_enabled: boolean;
  stars_rate: number;
  bank_enabled: boolean;
  bank_details: string;
  crypto_enabled: boolean;
  crypto_btc: string;
  crypto_eth: string;
  crypto_usdt_trc20: string;
  crypto_ton: string;
  stripe_enabled: boolean;
  updated_at: string;
};

export type Category = {
  id: string;
  name: string;
  position: number;
  created_at: string;
};

export type PastelColor = 'blue' | 'pink' | 'yellow' | 'mint';
export type DeliveryType = 'physical' | 'digital' | 'none';

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
  delivery_type: DeliveryType;
  digital_file_path: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductWithCategory = Product & { category_name: string };

export type OrderStatus =
  | 'Pending payment'
  | 'Paid'
  | 'Processing'
  | 'In transit'
  | 'Delivered'
  | 'Cancelled';

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
  payment_confirmed_at: string | null;
  delivered_at: string | null;
  payment_proof_url: string | null;
  payment_proof_note: string | null;
  payment_tx_hash: string | null;
  paid_confirmed_at: string | null;
  paid_confirmed_by: string | null;
  payment_redirect_url: string | null;
  created_at: string;
};

export type OrderWithReceipt = Order & { payment_proof_signed_url: string | null };

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

export type PaymentMethod = 'manual' | 'cod' | 'bank' | 'crypto' | 'stars' | 'stripe';

export type PaymentPayload =
  | { kind: 'none' }
  | { kind: 'stars'; invoice_url: string }
  | { kind: 'stripe'; url: string }
  | { kind: 'bank'; details: string }
  | {
      kind: 'crypto';
      addresses: { btc: string; eth: string; usdt_trc20: string; ton: string };
    }
  | { kind: 'cod' };

export type CreateOrderBody = {
  items: { product_id: string; quantity: number }[];
  delivery: { name: string; address: string; city: string; zip?: string };
  payment_method: PaymentMethod;
};

export type ProofSubmitBody = {
  note?: string;
  tx_hash?: string;
  proof_url?: string;
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
  delivery_type?: DeliveryType;
  digital_file_path?: string | null;
};

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
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
      data &&
      typeof data === 'object' &&
      'error' in data &&
      typeof (data as { error: unknown }).error === 'string'
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
    request<{ order: Order; payment: PaymentPayload }>('/api/orders', {
      method: 'POST',
      body,
    }),

  submitProof: (orderId: string, body: ProofSubmitBody) =>
    request<{ order: Order }>(`/api/orders/${orderId}/proof`, { method: 'POST', body }),

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
    request<{ orders: OrderWithReceipt[]; items: OrderItem[] }>(
      `/api/admin/orders${status && status !== 'All' ? `?status=${encodeURIComponent(status)}` : ''}`,
    ),

  updateOrderStatus: (id: string, status: OrderStatus) =>
    request<{ order: Order }>(`/api/admin/orders/${id}`, { method: 'PATCH', body: { status } }),

  confirmOrderPaid: (id: string) =>
    request<{ order: Order }>(`/api/admin/orders/${id}/confirm-paid`, { method: 'POST' }),

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
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

const ALLOWED_DIGITAL_TYPES = [
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/epub+zip',
  'application/octet-stream',
  'audio/mpeg',
  'audio/wav',
  'audio/mp4',
  'video/mp4',
];

const ALLOWED_RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/**
 * Uploads a file to Supabase Storage. `upsert` controls the
 * x-upsert header — true means the upload overwrites an existing object
 * at the same path. Receipts use upsert so a buyer can replace a bad
 * image; products and digital goods use create-only.
 */
async function uploadToBucket(
  file: File,
  bucket: string,
  path: string,
  maxBytes: number,
  allowed: string[],
  upsert = false,
): Promise<void> {
  if (!allowed.includes(file.type)) {
    throw new ApiError(400, `Unsupported file type: ${file.type || 'unknown'}.`);
  }
  if (file.size > maxBytes) {
    throw new ApiError(400, `File too large (max ${Math.round(maxBytes / 1024 / 1024)}MB).`);
  }
  if (!token) throw new ApiError(401, 'Not authenticated.');

  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: ANON_KEY,
      'x-upsert': upsert ? 'true' : 'false',
    },
    body: file,
  });

  if (!res.ok) throw new ApiError(res.status, 'Upload failed.');
}

export async function uploadProductImage(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${crypto.randomUUID()}.${ext}`;
  await uploadToBucket(file, 'products', path, MAX_IMAGE_BYTES, ALLOWED_IMAGE_TYPES);
  return `${SUPABASE_URL}/storage/v1/object/public/products/${path}`;
}

export async function uploadDigitalFile(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${crypto.randomUUID()}.${ext}`;
  await uploadToBucket(file, 'digital-goods', path, MAX_FILE_BYTES, ALLOWED_DIGITAL_TYPES);
  return path;
}

/**
 * Uploads a payment receipt to the private receipts bucket. RLS requires
 * the path to start with the uploading user's id, hence the folder.
 * `upsert: true` lets a buyer replace an earlier receipt for the same
 * order without hitting a 409.
 */
export async function uploadReceipt(
  file: File,
  userId: string,
  orderId: string,
): Promise<string> {
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeExt = ALLOWED_RECEIPT_TYPES.includes(file.type)
    ? ext || 'jpg'
    : 'jpg';
  const path = `${userId}/${orderId}.${safeExt}`;
  await uploadToBucket(file, 'receipts', path, MAX_RECEIPT_BYTES, ALLOWED_RECEIPT_TYPES, true);
  return path;
}

export function formatMoney(value: number | string, symbol: string): string {
  const n = typeof value === 'string' ? Number(value) : value;
  const r = Math.round(n * 100) / 100;
  return `${symbol}${r % 1 === 0 ? r.toString() : r.toFixed(2)}`;
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  stars: 'Telegram Stars',
  stripe: 'Card (Stripe)',
  bank: 'Bank transfer',
  crypto: 'Crypto',
  cod: 'Cash on Delivery',
  manual: 'Arrange with seller',
};
