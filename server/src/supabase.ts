import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';

/**
 * Service-role client.
 *
 * This client bypasses RLS. It is ONLY used inside the server. It must
 * never be shipped to the client bundle.
 *
 * Rationale: every write action on this server is authorised in code
 * (requireRole middleware) *and* re-checked by RLS as a second layer.
 * Using the service role here means we do not have to trust client
 * claims to satisfy the DB policies — we decide, then we write.
 */
export const supabaseAdmin: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/**
 * Anon client. Kept for completeness / future direct-from-client reads.
 * Not currently used by server routes.
 */
export const supabaseAnon: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
