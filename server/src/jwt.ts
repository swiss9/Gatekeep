import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { env } from './env.js';

/**
 * Supabase-compatible JWT.
 *
 * Signed with the project's JWT secret so Supabase (PostgREST, Storage)
 * accepts it directly. `sub` is the profile id, which RLS sees as
 * auth.uid(). This lets the client use supabase-js with the anon key +
 * this token for Storage uploads while RLS still gates by role.
 */
const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);

const ISSUER = 'gatekeep-shop';
const TTL = '7d';

export type SessionClaims = {
  sub: string;
  telegram_id: number;
};

export async function mintJwt(profileId: string, telegramId: number): Promise<string> {
  return await new SignJWT({ role: 'authenticated', telegram_id: telegramId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(profileId)
    .setAudience('authenticated')
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(secret);
}

export async function verifyJwt(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, secret, {
    issuer: ISSUER,
    audience: 'authenticated',
  });
  const sub = payload.sub;
  const telegramId = (payload as JWTPayload & { telegram_id?: unknown }).telegram_id;
  if (typeof sub !== 'string' || typeof telegramId !== 'number') {
    throw new Error('JWT: missing claims');
  }
  return { sub, telegram_id: telegramId };
}
