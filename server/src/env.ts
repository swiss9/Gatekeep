import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_JWT_SECRET: z.string().min(16),

  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]+$/, 'Invalid Telegram bot token'),
  ADMIN_TELEGRAM_ID: z.coerce.number().int().positive(),

  CLIENT_ORIGIN: z.string().url(),
  MINI_APP_URL: z.string().url(),

  // Required only when Stripe Link is enabled. Signature verification
  // uses this; without it the webhook route returns 503.
  STRIPE_WEBHOOK_SECRET: z.string().min(16).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

function load(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    console.error(`\n[env] Missing or invalid environment variables:\n${issues}\n`);
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = load();
