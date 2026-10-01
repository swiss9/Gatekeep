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
  constructor(
    public readonly status: number,
    message: string,
  ) {
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
 * Plain async function — verifies the bearer token, loads the profile,
 * and attaches it to req.profile. This is what hooks AND route handlers
 * call. No `this` binding, no Fastify hook type gymnastics.
 */
export async function authenticate(req: FastifyRequest): Promise<Profile> {
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
  return profile;
}

/** Fastify hook form — thin wrapper around authenticate(). */
export const requireAuth: preHandlerHookHandler = async (
  req: FastifyRequest,
  _reply: FastifyReply,
) => {
  await authenticate(req);
};

/** Hook form that also checks role. */
export function requireRole(...roles: Role[]): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const profile = await authenticate(req);
    if (!roles.includes(profile.role)) {
      throw new HttpError(403, 'Forbidden');
    }
  };
}

/** Typed accessor for handlers that already ran requireAuth. */
export function currentProfile(req: FastifyRequest): Profile {
  if (!req.profile) throw new HttpError(401, 'Not authenticated');
  return req.profile;
}
