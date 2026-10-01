import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { verifyJwt } from '../jwt.js';
import type { Profile, Role } from '../types.js';

declare module 'fastify' {
  interface FastifyRequest {
    profile?: Profile;
  }
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function getProfileById(id: string): Promise<Profile | null> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new HttpError(500, `profile lookup failed: ${error.message}`);
  return (data as Profile | null) ?? null;
}

/**
 * Verifies the bearer JWT and loads the profile.
 * The role is read fresh from the DB — never trusted from the JWT alone,
 * because a demoted admin would otherwise keep acting as admin until
 * their token expired.
 */
export const requireAuth: preHandlerHookHandler = async (
  req: FastifyRequest,
  _reply: FastifyReply,
) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new HttpError(401, 'Missing bearer token');
  }
  const token = header.slice('Bearer '.length).trim();

  let sub: string;
  try {
    ({ sub } = await verifyJwt(token));
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }

  const profile = await getProfileById(sub);
  if (!profile) throw new HttpError(401, 'Profile not found');

  req.profile = profile;
};

/** Role gate. Always layered on top of requireAuth. */
export function requireRole(...roles: Role[]): preHandlerHookHandler {
  return async (req, _reply) => {
    await requireAuth(req, _reply, () => undefined);
    const p = req.profile;
    if (!p) throw new HttpError(401, 'Not authenticated');
    if (!roles.includes(p.role)) throw new HttpError(403, 'Forbidden');
  };
}

/** Typed accessor for handlers that already ran requireAuth. */
export function currentProfile(req: FastifyRequest): Profile {
  if (!req.profile) throw new HttpError(401, 'Not authenticated');
  return req.profile;
}
