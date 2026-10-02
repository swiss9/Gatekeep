import { z } from 'zod';

export const AuthValidateSchema = z.object({
  initData: z.string().min(1),
  start_param: z.string().optional(),
});
export type AuthValidateInput = z.infer<typeof AuthValidateSchema>;

export const OrderItemInputSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
});

export const PAYMENT_METHODS = [
  'manual',
  'cod',
  'bank',
  'crypto',
  'stars',
  'stripe',
] as const;

// --- Validators for user-supplied text fields ---

// Name: 2-80 chars, letters / spaces / hyphens / apostrophes / periods.
const NAME_RE = /^[\p{L}][\p{L}\s'.\-]{1,79}$/u;

// Address: 5-240 chars, must contain at least one letter and one digit.
// Rejects "asdf", "aaaaa", "12345" as standalone.
const ADDRESS_RE = /^(?=.*[\p{L}])(?=.*\d)[\p{L}\p{N}\s.,'#/\-]{4,239}$/u;

// City: 2-80 chars, letters + spaces + hyphens + apostrophes.
const CITY_RE = /^[\p{L}][\p{L}\s'\-]{1,79}$/u;

// ZIP / postal: 2-12 alphanumerics, optional space or hyphen.
const ZIP_RE = /^[\p{N}A-Za-z][\p{N}A-Za-z\s\-]{1,11}$/u;

// TX hash: 10-200 chars, hex-ish (0x…) or alphanumeric.
const TX_RE = /^(0x)?[A-Za-z0-9]{8,200}$/;

// Crypto address — loose format checks per chain.
const BTC_RE = /^(bc1|[13])[A-Za-z0-9]{25,62}$/;
const ETH_RE = /^0x[a-fA-F0-9]{40}$/;
const TRC20_RE = /^T[A-Za-z0-9]{33}$/;
const TON_RE = /^(EQ|UQ|0:)[A-Za-z0-9_\-]{20,}$/;

export const OrderCreateSchema = z.object({
  items: z.array(OrderItemInputSchema).min(1).max(50),
  delivery: z.object({
    name: z.string().trim().regex(NAME_RE, 'Enter a real name'),
    // Empty string allowed for digital-only orders. Otherwise must
    // look like a real address.
    address: z
      .string()
      .trim()
      .max(240)
      .optional()
      .default('')
      .refine(
        (v) => v === '' || ADDRESS_RE.test(v),
        'Enter a full address (must include a number)',
      ),
    city: z
      .string()
      .trim()
      .max(120)
      .optional()
      .default('')
      .refine((v) => v === '' || CITY_RE.test(v), 'Enter a real city name'),
    zip: z
      .string()
      .trim()
      .max(20)
      .optional()
      .default('')
      .refine((v) => v === '' || ZIP_RE.test(v), 'Enter a valid ZIP / postal code'),
  }),
  payment_method: z.enum(PAYMENT_METHODS),
});
export type OrderCreateInput = z.infer<typeof OrderCreateSchema>;

export const ProofSubmitSchema = z
  .object({
    note: z.string().trim().max(500).optional().default(''),
    tx_hash: z
      .string()
      .trim()
      .max(200)
      .optional()
      .default('')
      .refine((v) => v === '' || TX_RE.test(v), 'Enter a valid transaction hash'),
    proof_url: z.string().max(500).optional().default(''),
  })
  .refine((v) => v.note.length > 0 || v.tx_hash.length > 0 || v.proof_url.length > 0, {
    message: 'Add a note, tx hash, or receipt',
  });
export type ProofSubmitInput = z.infer<typeof ProofSubmitSchema>;

export const ProductCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional().default(''),
  price: z.number().nonnegative().max(1_000_000),
  category_id: z.string().uuid().nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  pastel_color: z.enum(['blue', 'pink', 'yellow', 'mint']).default('blue'),
  stock: z.number().int().min(0).max(1_000_000).default(0),
  active: z.boolean().default(true),
  delivery_type: z.enum(['physical', 'digital', 'none']).default('physical'),
  digital_file_path: z.string().nullable().optional(),
});

export const ProductUpdateSchema = ProductCreateSchema.partial();

export const CategoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  position: z.number().int().min(0).optional(),
});

export const CategoryUpdateSchema = CategoryCreateSchema.partial();

export const SettingsUpdateSchema = z.object({
  store_name: z.string().trim().min(1).max(80).optional(),
  store_tagline: z.string().trim().max(80).optional(),
  currency_symbol: z.string().trim().min(1).max(4).optional(),
  currency_code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{3}$/)
    .optional(),
  shipping_threshold: z.number().nonnegative().optional(),
  shipping_cost: z.number().nonnegative().optional(),
  banner_enabled: z.boolean().optional(),
  banner_eyebrow: z.string().trim().max(40).optional(),
  banner_title: z.string().trim().max(120).optional(),
  banner_subtitle: z.string().trim().max(160).optional(),
  banner_cta: z.string().trim().max(40).optional(),
  banner_cta_action: z.enum(['all', 'category', 'search']).optional(),
  banner_color: z.enum(['mint', 'blue', 'pink', 'yellow', 'neutral']).optional(),
  payment_provider: z.enum(PAYMENT_METHODS).optional(),
  payment_url: z.string().max(500).optional(),
  payment_ton_address: z.string().max(120).optional(),
  perks_enabled: z.boolean().optional(),
  perk_1_text: z.string().trim().max(80).optional(),
  perk_2_text: z.string().trim().max(80).optional(),
  perk_3_text: z.string().trim().max(80).optional(),
  stars_enabled: z.boolean().optional(),
  stars_rate: z.number().positive().max(10_000).optional(),
  bank_enabled: z.boolean().optional(),
  bank_details: z.string().max(2000).optional(),
  crypto_enabled: z.boolean().optional(),
  crypto_btc: z
    .string()
    .max(200)
    .optional()
    .refine((v) => !v || v === '' || BTC_RE.test(v), 'Not a valid BTC address'),
  crypto_eth: z
    .string()
    .max(200)
    .optional()
    .refine((v) => !v || v === '' || ETH_RE.test(v), 'Not a valid ETH address'),
  crypto_usdt_trc20: z
    .string()
    .max(200)
    .optional()
    .refine((v) => !v || v === '' || TRC20_RE.test(v), 'Not a valid TRC20 address'),
  crypto_ton: z
    .string()
    .max(200)
    .optional()
    .refine((v) => !v || v === '' || TON_RE.test(v), 'Not a valid TON address'),
  stripe_enabled: z.boolean().optional(),
});

export const OrderStatusUpdateSchema = z.object({
  status: z.enum([
    'Pending payment',
    'Paid',
    'Processing',
    'In transit',
    'Delivered',
    'Cancelled',
  ]),
});

export const InviteCreateSchema = z.object({
  grants_role: z.enum(['admin', 'superadmin']),
});

export const RoleUpdateSchema = z.object({
  role: z.enum(['admin', 'superadmin']),
});

export const TransferSchema = z.object({
  target_id: z.string().uuid(),
});

// Exposed so the client bundle can mirror the same rules. Kept minimal.
export const VALIDATORS = {
  NAME_RE,
  ADDRESS_RE,
  CITY_RE,
  ZIP_RE,
  TX_RE,
  BTC_RE,
  ETH_RE,
  TRC20_RE,
  TON_RE,
};
