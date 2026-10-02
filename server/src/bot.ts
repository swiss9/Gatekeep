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

type TelegramUpdate = {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
  pre_checkout_query?: {
    id: string;
    invoice_payload: string;
  };
  successful_payment?: {
    invoice_payload: string;
    telegram_payment_charge_id: string;
    total_amount: number;
    currency: string;
  };
  // Telegram nests successful_payment inside message. Support both.
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

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  // /start
  const text = update.message?.text;
  if (text?.startsWith('/start')) {
    await handleStart(update.message!.chat.id);
    return;
  }

  // Telegram Stars pre-checkout. Must respond within 10 seconds.
  if (update.pre_checkout_query) {
    const q = update.pre_checkout_query;
    const orderId = q.invoice_payload.startsWith('order:')
      ? q.invoice_payload.slice('order:'.length)
      : null;

    if (!orderId) {
      await callTelegram('answerPreCheckoutQuery', {
        pre_checkout_query_id: q.id,
        ok: false,
        error_message: 'Invalid order reference.',
      });
      return;
    }

    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('id, status')
      .eq('id', orderId)
      .maybeSingle();

    if (!order || order.status !== 'Pending payment') {
      await callTelegram('answerPreCheckoutQuery', {
        pre_checkout_query_id: q.id,
        ok: false,
        error_message: 'This order is no longer payable.',
      });
      return;
    }

    await callTelegram('answerPreCheckoutQuery', {
      pre_checkout_query_id: q.id,
      ok: true,
    });
  }
}

/**
 * Marks an order paid in response to a Telegram Stars payment. Called
 * from the poll loop when Telegram confirms payment. Idempotent: only
 * flips if the order is still 'Pending payment'.
 */
async function markOrderPaidFromStars(
  invoicePayload: string,
  chargeId: string,
): Promise<void> {
  const orderId = invoicePayload.startsWith('order:')
    ? invoicePayload.slice('order:'.length)
    : null;
  if (!orderId) return;

  const { data: existing } = await supabaseAdmin
    .from('orders')
    .select('id, status, order_code, user_id')
    .eq('id', orderId)
    .maybeSingle();
  if (!existing || existing.status !== 'Pending payment') return;

  await supabaseAdmin
    .from('orders')
    .update({
      status: 'Paid',
      payment_confirmed_at: new Date().toISOString(),
      paid_confirmed_at: new Date().toISOString(),
      payment_tx_hash: chargeId,
    })
    .eq('id', orderId);

  // Notify buyer.
  if (existing.user_id) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('telegram_id')
      .eq('id', existing.user_id)
      .maybeSingle();
    if (profile?.telegram_id) {
      try {
        await sendMessage(
          Number(profile.telegram_id),
          `<b>Payment confirmed</b>\n\nOrder #${existing.order_code} is paid. We'll notify you again when it ships.`,
          webAppButton('View order'),
        );
      } catch (err) {
        console.error('[bot] stars buyer notify failed:', err);
      }
    }
  }

  console.log(`[bot] order ${existing.order_code} marked paid via Stars`);
}

async function pollLoop(): Promise<void> {
  while (running) {
    try {
      const res = await fetch(`${BOT_API}/getUpdates?offset=${offset}&timeout=30`);
      const json = (await res.json()) as {
        ok: boolean;
        result?: TelegramUpdate[];
      };
      if (json.ok && Array.isArray(json.result)) {
        for (const update of json.result) {
          offset = update.update_id + 1;
          try {
            await handleUpdate(update);

            // successful_payment can arrive at message.successful_payment
            // or (rarely) top-level depending on update shape.
            const sp =
              (update as unknown as { message?: { successful_payment?: TelegramUpdate['successful_payment'] } })
                .message?.successful_payment ?? update.successful_payment;
            if (sp?.invoice_payload && sp.telegram_payment_charge_id) {
              await markOrderPaidFromStars(sp.invoice_payload, sp.telegram_payment_charge_id);
            }
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
 * Creates a Telegram Stars invoice link. The buyer pays inside Telegram;
 * successful_payment arrives on the bot and flips the order to Paid.
 */
export async function createStarsInvoiceLink(params: {
  title: string;
  description: string;
  payload: string;
  starsAmount: number;
}): Promise<string | null> {
  const res = await fetch(`${BOT_API}/createInvoiceLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: params.title.slice(0, 32),
      description: params.description.slice(0, 255),
      payload: params.payload,
      currency: 'XTR',
      prices: [{ label: 'Total', amount: params.starsAmount }],
    }),
  });

  const json = (await res.json()) as { ok: boolean; result?: string; description?: string };
  if (!json.ok || !json.result) {
    console.error('[bot] createInvoiceLink failed:', json.description);
    return null;
  }
  return json.result;
}

// ---------------------------------------------------------------------
// Notifications (unchanged from prior version)
// ---------------------------------------------------------------------

export async function notifyAdminsOfOrder(order: {
  code: string;
  customer: string;
  city: string;
  total: number;
  payment_method: string;
}): Promise<void> {
  const { data: admins } = await supabaseAdmin
    .from('profiles')
    .select('telegram_id')
    .in('role', ['admin', 'superadmin']);
  if (!admins || admins.length === 0) return;

  const { currency_symbol } = await loadSettings();
  const methodLabel = order.payment_method.replace('_', ' ');
  const text = `<b>New order received</b>\n\n#${order.code}\n${order.customer} · ${order.city}\n${currency_symbol}${order.total} · via ${methodLabel}`;

  for (const a of admins) {
    try {
      await sendMessage(Number(a.telegram_id), text, webAppButton('Open Admin'));
    } catch (err) {
      console.error('[bot] admin notify failed:', err);
    }
  }
}

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

export async function notifyBuyerPaymentConfirmed(params: {
  telegramId: number;
  orderCode: string;
}): Promise<void> {
  try {
    await sendMessage(
      params.telegramId,
      `<b>Payment confirmed</b>\n\nOrder #${params.orderCode} is paid. We'll let you know when it ships.`,
      webAppButton('View order'),
    );
  } catch (err) {
    console.error('[bot] buyer payment notify failed:', err);
  }
}

export async function deliverDigitalGood(params: {
  telegramId: number;
  orderCode: string;
  productName: string;
  filePath: string;
}): Promise<boolean> {
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
