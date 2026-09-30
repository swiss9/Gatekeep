import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { env } from '../env.js';
import { validateInitData } from '../telegram.js';
import { mintJwt } from '../jwt.js';
import { AuthValidateSchema } from '../schemas.js';
import { HttpError } from '../middleware/auth.js';
import type { AdminInvite, Profile, Role } from '../types.js';

/**
 * Role ordering. Used to guarantee invites can only ever *raise* a
 * role, never lower it — a superadmin who clicks an admin invite link
 * keeps superadmin.
 */
const ROLE_RANK: Record<Role, number> = {
  customer: 0,
  admin: 1,
  superadmin: 2,
};

/**
 * POST /api/auth/validate
 *
 * Called on every Mini App open. Steps:
 *   1. Verify Telegram initData HMAC.
 *   2. Load-or-create profile keyed on telegram_id.
 *   3. If start_param is `inv_<token>`, try to redeem the invite.
 *   4. If telegram_id === ADMIN_TELEGRAM_ID, force role = superadmin.
 *   5. Mint a Supabase-compatible JWT.
 */
export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/auth/validate', async (req, reply) => {
    const { initData, start_param } = AuthValidateSchema.parse(req.body);

    let tg;
    try {
      tg = validateInitData(initData);
    } catch (err) {
      throw new HttpError(401, err instanceof Error ? err.message : 'initData invalid');
    }

    const startParam = start_param ?? tg.startParam;

    // ---- Load or create the profile ----
    let profile = await loadProfileByTelegramId(tg.user.id);
    if (!profile) {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: randomUUID(),
          telegram_id: tg.user.id,
          username: tg.user.username ?? null,
          first_name: tg.user.first_name ?? null,
          role: 'customer',
        })
        .select()
        .single();
      if (error || !data) throw new HttpError(500, `profile create failed: ${error?.message ?? 'unknown'}`);
      profile = data as Profile;
    } else {
      // Refresh display fields (username may have changed in Telegram).
      const { data } = await supabaseAdmin
        .from('profiles')
        .update({
          username: tg.user.username ?? null,
          first_name: tg.user.first_name ?? null,
        })
        .eq('id', profile.id)
        .select()
        .single();
      if (data) profile = data as Profile;
    }

    // ---- Invite redemption ----
    if (startParam && startParam.startsWith('inv_')) {
      profile = await redeemInvite(profile, startParam.slice('inv_'.length));
    }

    // ---- Owner escape hatch ----
    // The ADMIN_TELEGRAM_ID account is always superadmin, no matter what
    // the DB says. This means the original owner can always recover the
    // store even if another admin demotes them.
    if (Number(profile.telegram_id) === env.ADMIN_TELEGRAM_ID && profile.role !== 'superadmin') {
      const { data } = await supabaseAdmin
        .from('profiles')
        .update({ role: 'superadmin' })
        .eq('id', profile.id)
        .select()
        .single();
      if (data) profile = data as Profile;
    }

    const token = await mintJwt(profile.id, Number(profile.telegram_id));
    return reply.send({ token, profile });
  });
};

async function loadProfileByTelegramId(telegramId: number): Promise<Profile | null> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw new HttpError(500, `profile lookup failed: ${error.message}`);
  return (data as Profile | null) ?? null;
}

/**
 * Redeem a one-time, 48h admin invite.
 *
 * Silently returns the unchanged profile if the invite is missing,
 * used, or expired — the user simply gets normal customer access.
 *
 * Role changes are upgrades only: if the invite's grants_role is lower
 * than or equal to the profile's current role, the role is left alone.
 * A superadmin who clicks an `admin` invite therefore keeps superadmin.
 */
async function redeemInvite(profile: Profile, token: string): Promise<Profile> {
  const { data: invite } = await supabaseAdmin
    .from('admin_invites')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (!invite) return profile;

  const inv = invite as AdminInvite;
  if (inv.used_by) return profile;
  if (new Date(inv.expires_at).getTime() <= Date.now()) return profile;

  // Only upgrade. Compare ranks so future role additions do not
  // silently break this check.
  let updated = profile;
  if (ROLE_RANK[inv.grants_role] > ROLE_RANK[profile.role]) {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({ role: inv.grants_role, invited_by: inv.created_by })
      .eq('id', profile.id)
      .select()
      .single();
    if (error || !data) return profile;
    updated = data as Profile;
  }

  // Burn the invite either way. If a superadmin clicked their own
  // admin link, we do not want a live token sitting around waiting to
  // be leaked.
  await supabaseAdmin
    .from('admin_invites')
    .update({ used_by: profile.id, used_at: new Date().toISOString() })
    .eq('id', inv.id);

  return updated;
}
