import { supabaseAdmin } from './supabase.js';
import { env } from './env.js';

const BOT_API = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

let offset = 0;
let running = false;

type InlineKeyboardButton = {
  text: string;
  web_app?: { url: string };
  url?: string;
};

type ReplyMarkup = {
  reply_markup: {
    inline_keyboard: InlineKeyboardButton[][];
  };
};

async function callTelegram(method: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BOT_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendMessage(
  chatId: number,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

function webAppButton(label: string): ReplyMarkup {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: label, web_app: { url: env.MINI_APP_URL } }]],
    },
  };
}

function urlButton(label: string, url: string): ReplyMarkup {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: label, url }]],
    },
  };
}

async function loadSettings(): Promise<{
  store_name: string;
  currency_symbol: string;
}> {
  const { data } = await supabaseAdmin
    .from('store_settings')
    .select('store_name, currency_symbol')
    .eq('id', 1)
    .maybeSingle();
  return {
    store_name: data?.store_name ?? 'the store',
    currency_symbol: data?.currency_symbol ?? '$',
  };
}

async function handleStart(chatId: number): Promise<void> {
  const { store_name } = await loadSettings();
  await sendMessage(
    chatId,
    `Welcome to <b>${store_name}</b>!\n\nTap the button below to browse the catalog.`,
    webAppButton('Open Shop'),
  );
}

async function handleUpdate(update: {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
}): Promise<void> {
  const text = update.message?.text;
  if (text?.startsWith('/start')) {
    await handleStart(update.message!.chat.id);
  }
}

async function pollLoop(): Promise<void> {
  while (running) {
    try {
      const res = await fetch(`${BOT_API}/getUpdates?offset=${offset}&timeout=30`);
      const json = (await res.json()) as {
        ok: boolean;
        result?: Array<{
          update_id: number;
          message?: { chat: { id: number }; text?: string };
        }>;
      };
      if (json.ok && Array.isArray(json.result)) {
        for (const update of json.result) {
          offset = update.update_id + 1;
          try {
            await handleUpdate(update);
          } catch (err) {
            console.error('[bot] handleUpdate error:', err);
          }
        }
      }
    } catch (err) {
      console.error('[bot] poll error:', err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

export function startBot(): void {
  if (running) return;
  running = true;
  console.log('[bot] long-polling started');
  void pollLoop();
}

export function stopBot(): void {
  running = false;
}

// ---------------------------------------------------------------------
// Admin notifications
// ---------------------------------------------------------------------

export async function notifyAdminsOfOrder(order: {
  code: string;
  customer: string;
  city: string;
  total: number;
}): Promise<void> {
  const { data: admins } = await supabaseAdmin
    .from('profiles')
    .select('telegram_id')
    .in('role', ['admin', 'superadmin']);

  if (!admins || admins.length === 0) return;

  const { currency_symbol } = await loadSettings();
  const text = `<b>New order received</b>\n\n#${order.code}\n${order.customer} · ${order.city}\n${currency_symbol}${order.total}`;

  for (const a of admins) {
    try {
      await sendMessage(Number(a.telegram_id), text, webAppButton('Open Admin'));
    } catch (err) {
      console.error('[bot] admin notify failed:', err);
    }
  }
}

// ---------------------------------------------------------------------
// Buyer notifications
// ---------------------------------------------------------------------

/**
 * Sends a "your order is ready" ping to the buyer. Swallows its own
 * errors: a blocked bot or deleted account must never fail the admin's
 * status-update request.
 */
export async function notifyBuyerOfDelivery(params: {
  telegramId: number;
  orderCode: string;
}): Promise<void> {
  const { store_name } = await loadSettings();
  try {
    await sendMessage(
      params.telegramId,
      `<b>Your order is ready</b>\n\nOrder #${params.orderCode} from ${store_name}. Tap below to view.`,
      webAppButton('View order'),
    );
  } catch (err) {
    console.error('[bot] buyer notify failed:', err);
  }
}

export async function deliverDigitalGood(params: {
  telegramId: number;
  orderCode: string;
  productName: string;
  filePath: string;
}): Promise<boolean> {
  // 24-hour signed URL. Buyer clicks it in Telegram; Supabase serves the
  // file directly. After 24h the link is dead and cannot be reshared.
  const { data, error } = await supabaseAdmin.storage
    .from('digital-goods')
    .createSignedUrl(params.filePath, 60 * 60 * 24);

  if (error || !data?.signedUrl) {
    console.error('[bot] signed url failed:', error);
    return false;
  }

  const text = `<b>Your download is ready</b>\n\n${params.productName}\nOrder #${params.orderCode}\n\nLink expires in 24 hours.`;

  try {
    await sendMessage(params.telegramId, text, urlButton('Download', data.signedUrl));
    return true;
  } catch (err) {
    console.error('[bot] digital delivery failed:', err);
    return false;
  }
}

// ---------------------------------------------------------------------
// Product broadcast (buyers only)
// ---------------------------------------------------------------------

export async function broadcastNewProduct(product: {
  name: string;
  price: number;
}): Promise<void> {
  const { data: orders } = await supabaseAdmin
    .from('orders')
    .select('user_id')
    .not('user_id', 'is', null);

  const uniqueIds = [
    ...new Set(
      (orders ?? [])
        .map((o) => o.user_id as string | null)
        .filter((id): id is string => id !== null),
    ),
  ];

  if (uniqueIds.length === 0) {
    console.log('[bot] broadcast skipped: no buyers yet');
    return;
  }

  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('telegram_id')
    .in('id', uniqueIds);

  if (!profiles || profiles.length === 0) {
    console.log('[bot] broadcast skipped: no matching profiles');
    return;
  }

  const { store_name, currency_symbol } = await loadSettings();
  const text = `<b>New in ${store_name}</b>\n\n${product.name} — ${currency_symbol}${product.price}`;

  let sent = 0;
  for (const p of profiles) {
    try {
      await sendMessage(Number(p.telegram_id), text, webAppButton('View in Shop'));
      sent += 1;
      if (sent % 25 === 0) await new Promise((r) => setTimeout(r, 1100));
    } catch (err) {
      console.error(`[bot] broadcast to ${p.telegram_id} failed:`, err);
    }
  }
  console.log(`[bot] broadcast sent to ${sent}/${profiles.length} buyers`);
}
