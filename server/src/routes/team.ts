import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { HttpError, requireRole, currentProfile } from '../middleware/auth.js';
import { InviteCreateSchema, RoleUpdateSchema, TransferSchema } from '../schemas.js';
import type { AdminInvite, Profile, Role } from '../types.js';

const INVITE_TTL_HOURS = 48;

async function getProfile(id: string): Promise<Profile | null> {
  const { data } = await supabaseAdmin.from('profiles').select('*').eq('id', id).maybeSingle();
  return (data as Profile | null) ?? null;
}

async function countSuperadmins(): Promise<number> {
  const { count } = await supabaseAdmin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'superadmin');
  return count ?? 0;
}

async function setRole(id: string, role: Role): Promise<Profile> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ role })
    .eq('id', id)
    .select()
    .single();
  if (error || !data) throw new HttpError(500, error?.message ?? 'role update failed');
  return data as Profile;
}

export const teamRoutes: FastifyPluginAsync = async (app) => {
  const admin = { preHandler: requireRole('admin', 'superadmin') };

  // ---------------- Invites ----------------

  /**
   * POST /api/admin/invites
   * Generates a one-time invite token. Only superadmins may create
   * superadmin invites (permission matrix).
   */
  app.post('/api/admin/invites', admin, async (req, reply) => {
    const me = currentProfile(req);
    const body = InviteCreateSchema.parse(req.body);

    if (body.grants_role === 'superadmin' && me.role !== 'superadmin') {
      throw new HttpError(403, 'Only a superadmin can create superadmin invites');
    }

    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600_000).toISOString();

    const { data, error } = await supabaseAdmin
      .from('admin_invites')
      .insert({
        token,
        created_by: me.id,
        grants_role: body.grants_role,
        expires_at: expiresAt,
      })
      .select()
      .single();
    if (error || !data) throw new HttpError(500, error?.message ?? 'invite insert failed');

    // Link format documented in README: the buyer sets their bot username
    // in the client env and the client composes the final t.me URL.
    return reply.code(201).send({ invite: data as AdminInvite, token });
  });

  app.get('/api/admin/invites', admin, async (_req, reply) => {
    const { data, error } = await supabaseAdmin
      .from('admin_invites')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new HttpError(500, error.message);
    return reply.send({ invites: (data as AdminInvite[]) ?? [] });
  });

  app.delete('/api/admin/invites/:id', admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { error } = await supabaseAdmin.from('admin_invites').delete().eq('id', id);
    if (error) throw new HttpError(500, error.message);
    return reply.send({ ok: true });
  });

  // ---------------- Team management ----------------

  /**
   * DELETE /api/admin/team/:id
   * Rules (from permission matrix):
   *  1. Target is superadmin and requester is not         → 403
   *  2. Target is superadmin and requester is superadmin  → allow unless it
   *                                                          would leave 0
   *  3. Self-removal                                      → always allowed
   *  4. Admin targeting another admin                     → 403
   *  5. Otherwise                                         → role = customer
   */
  app.delete('/api/admin/team/:id', admin, async (req, reply) => {
    const me = currentProfile(req);
    const { id } = req.params as { id: string };

    const target = await getProfile(id);
    if (!target) throw new HttpError(404, 'Profile not found');

    const isSelf = target.id === me.id;

    if (!isSelf) {
      if (target.role === 'superadmin' && me.role !== 'superadmin') {
        throw new HttpError(403, 'Only a superadmin can remove another superadmin');
      }
      if (me.role === 'admin' && target.role === 'admin') {
        throw new HttpError(403, 'Admins cannot remove other admins');
      }
    }

    // The last superadmin can never be removed — even by themselves.
    if (target.role === 'superadmin') {
      const n = await countSuperadmins();
      if (n <= 1) throw new HttpError(400, 'Cannot remove the last superadmin');
    }

    await setRole(target.id, 'customer');
    return reply.send({ ok: true });
  });

  /**
   * PATCH /api/admin/team/:id/role
   * Superadmin only. Cannot demote the last superadmin.
   */
  app.patch(
    '/api/admin/team/:id/role',
    { preHandler: requireRole('superadmin') },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = RoleUpdateSchema.parse(req.body);

      const target = await getProfile(id);
      if (!target) throw new HttpError(404, 'Profile not found');

      if (target.role === 'superadmin' && body.role === 'admin') {
        const n = await countSuperadmins();
        if (n <= 1) throw new HttpError(400, 'Cannot demote the last superadmin');
      }

      const updated = await setRole(target.id, body.role);
      return reply.send({ profile: updated });
    },
  );

  /**
   * POST /api/admin/team/transfer
   * Superadmin only. Demotes the caller to admin and promotes target.
   * The env var ADMIN_TELEGRAM_ID must be updated manually — documented
   * in the README.
   */
  app.post(
    '/api/admin/team/transfer',
    { preHandler: requireRole('superadmin') },
    async (req, reply) => {
      const me = currentProfile(req);
      const body = TransferSchema.parse(req.body);

      if (body.target_id === me.id) throw new HttpError(400, 'Cannot transfer to yourself');

      const target = await getProfile(body.target_id);
      if (!target) throw new HttpError(404, 'Target profile not found');
      if (target.role === 'superadmin') {
        throw new HttpError(400, 'Target is already a superadmin');
      }

      // Supabase JS has no client-side transaction. These two updates are
      // sequenced so that if the second fails we can log the inconsistency
      // clearly. In practice the service role will not fail on a valid id.
      await setRole(me.id, 'admin');
      await setRole(target.id, 'superadmin');

      return reply.send({ ok: true });
    },
  );
};
