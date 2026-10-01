import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env.js';

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
};

export type InitData = {
  user: TelegramUser;
  startParam: string | undefined;
  authDate: number;
};

const MAX_AGE_SECONDS = 60 * 60 * 24;

export function validateInitData(initData: string): InitData {
  // Telegram sends values URL-encoded. URLSearchParams uses form-encoding,
  // where '+' means space. Telegram's '+' is a literal plus. Escape any
  // '+' as %2B first so it survives parsing.
  const normalized = initData.replace(/\+/g, '%2B');
  const params = new URLSearchParams(normalized);

  const hash = params.get('hash');
  if (!hash) throw new Error('initData: missing hash');

  // Only remove `hash` — `signature` (Ed25519) is included in the
  // HMAC data-check-string per the 2025 Telegram spec.
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData')
    .update(env.TELEGRAM_BOT_TOKEN)
    .digest();

  const expectedHex = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('initData: invalid hash');
  }

  const authDate = Number(params.get('auth_date') ?? 0);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw new Error('initData: missing auth_date');
  }
  if (Date.now() / 1000 - authDate > MAX_AGE_SECONDS) {
    throw new Error('initData: expired');
  }

  const userRaw = params.get('user');
  if (!userRaw) throw new Error('initData: missing user');

  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw) as TelegramUser;
  } catch {
    throw new Error('initData: malformed user JSON');
  }
  if (typeof user.id !== 'number') throw new Error('initData: user.id missing');

  return {
    user,
    startParam: params.get('start_param') ?? undefined,
    authDate,
  };
    }
