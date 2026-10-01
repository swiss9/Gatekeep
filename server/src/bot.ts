import { supabaseAdmin } from './supabase.js';
import { env } from './env.js';

const BOT_API = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

let offset = 0;
let running = false;

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

function webAppButton(label: string): unknown {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: label, web_app: { url: env.MINI_APP_URL } }]],
    },
  };
}

async function loadStoreName(): Promise<string> {
  const { data } = await supabaseAdmin
    .from('store_settings')
    .select('store_name')
    .eq('id', 1)
    .maybeSingle();
  return data?.store_name ?? 'our store';
}

async function handleStart(chatId: number): Promise<void> {
  const name = await loadStoreName();
  await sendMessage(
    chatId,
    `Welcome to <b>${name}</b>!\n\nTap the button below to browse the catalog.`,
    webAppButton('Open Shop'),
  );
}

async function handleUpdate(update: {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
  };
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

/**
 * Broadcast a new product to customers who have placed at least one order.
 *
 * Target selection: unique user_ids from the orders table joined to
 * profiles. This excludes admins and casual browsers — only people who
 * have already bought something hear about new products.
 *
 * To broadcast to every user who has opened the app instead (wider reach,
 * lower engagement, higher block risk), replace the target-query block
 * with:
 *
 *   const { data: profiles } = await supabaseAdmin
 *     .from('profiles')
 *     .select('telegram_id')
 *     .eq('role', 'customer');
 *
 * ...and delete the orders query.
 */
export async function broadcastNewProduct(product: {
  name: string;
  price: number;
}): Promise<void> {
  // ---- Target: users with at least one order ----
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

  // ---- Store metadata for the message ----
  const { data: settings } = await supabaseAdmin
    .from('store_settings')
    .select('store_name, currency_symbol')
    .eq('id', 1)
    .maybeSingle();

  const storeName = settings?.store_name ?? 'the store';
  const symbol = settings?.currency_symbol ?? '$';

  const text = `<b>New in ${storeName}</b>\n\n${product.name} — ${symbol}${product.price}`;

  // ---- Send with throttling ----
  let sent = 0;
  for (const p of profiles) {
    try {
      await sendMessage(
        Number(p.telegram_id),
        text,
        webAppButton('View in Shop'),
      );
      sent += 1;
      // Telegram allows ~30 msg/sec. Throttle every 25 messages.
      if (sent % 25 === 0) {
        await new Promise((r) => setTimeout(r, 1100));
      }
    } catch (err) {
      console.error(`[bot] broadcast to ${p.telegram_id} failed:`, err);
    }
  }
  console.log(`[bot] broadcast sent to ${sent}/${profiles.length} buyers`);
}
