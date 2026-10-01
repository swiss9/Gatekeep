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
  const params = new URLSearchParams(initData);

  const hash = params.get('hash');
  if (!hash) throw new Error('initData: missing hash');

  params.delete('hash');
  params.delete('signature');

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

  // ---- DIAGNOSTIC LOGS (remove after debugging) ----
  // eslint-disable-next-line no-console
  console.log('=== telegram initData debug ===');
  // eslint-disable-next-line no-console
  console.log('token_len:', env.TELEGRAM_BOT_TOKEN.length);
  // eslint-disable-next-line no-console
  console.log('token_prefix:', env.TELEGRAM_BOT_TOKEN.slice(0, 12));
  // eslint-disable-next-line no-console
  console.log('token_suffix:', env.TELEGRAM_BOT_TOKEN.slice(-6));
  // eslint-disable-next-line no-console
  console.log('hash_received:', hash.slice(0, 12));
  // eslint-disable-next-line no-console
  console.log('hash_expected:', expectedHex.slice(0, 12));
  // eslint-disable-next-line no-console
  console.log('data_check_len:', dataCheckString.length);
  // eslint-disable-next-line no-console
  console.log('data_check_keys:', [...params.keys()].sort().join(','));
  // eslint-disable-next-line no-console
  console.log('===============================');
  // --------------------------------------------------

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
