import { z } from 'zod';

/** Payload of POST /api/auth/validate. */
export const AuthValidateSchema = z.object({
  initData: z.string().min(1),
  start_param: z.string().optional(),
});
export type AuthValidateInput = z.infer<typeof AuthValidateSchema>;

/** Payload of POST /api/orders. */
export const OrderItemInputSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
});

export const OrderCreateSchema = z.object({
  items: z.array(OrderItemInputSchema).min(1).max(50),
  delivery: z.object({
    name: z.string().trim().min(1).max(120),
    address: z.string().trim().min(1).max(240),
    city: z.string().trim().min(1).max(120),
    zip: z.string().trim().max(20).optional().default(''),
  }),
  payment_method: z.enum(['card', 'apple', 'cod']),
});
export type OrderCreateInput = z.infer<typeof OrderCreateSchema>;

/** Product create/update. Image is uploaded to Storage by the client
 *  directly (using the user's Supabase JWT); the server only stores the URL. */
export const ProductCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional().default(''),
  price: z.number().nonnegative().max(1_000_000),
  category_id: z.string().uuid().nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  pastel_color: z.enum(['blue', 'pink', 'yellow', 'mint']).default('blue'),
  stock: z.number().int().min(0).max(1_000_000).default(0),
  active: z.boolean().default(true),
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
  shipping_threshold: z.number().nonnegative().optional(),
  shipping_cost: z.number().nonnegative().optional(),
  banner_enabled: z.boolean().optional(),
  banner_eyebrow: z.string().trim().max(40).optional(),
  banner_title: z.string().trim().max(120).optional(),
  banner_subtitle: z.string().trim().max(160).optional(),
  banner_cta: z.string().trim().max(40).optional(),
  banner_cta_action: z.enum(['all', 'category', 'search']).optional(),
  banner_color: z.enum(['mint', 'blue', 'pink', 'yellow', 'neutral']).optional(),
});

export const OrderStatusUpdateSchema = z.object({
  status: z.enum(['Processing', 'In transit', 'Delivered', 'Cancelled']),
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
