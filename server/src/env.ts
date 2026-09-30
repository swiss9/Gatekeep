import { z } from 'zod';

/**
 * All environment variables are validated at process start.
 * If anything is missing or malformed, the process exits with a
 * readable error before it ever accepts a request.
 */
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
});

export type Env = z.infer<typeof EnvSchema>;

function load(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`\n[env] Missing or invalid environment variables:\n${issues}\n`);
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = load();
