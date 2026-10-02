export function getInitData(): string {
  return window.Telegram?.WebApp?.initData ?? '';
}

export function getStartParam(): string | undefined {
  return window.Telegram?.WebApp?.initDataUnsafe?.start_param;
}

export function haptic(style: 'light' | 'medium' | 'heavy' = 'light'): void {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
}

type WebApp = {
  openTelegramLink?: (url: string) => void;
  openLink?: (url: string) => void;
  openInvoice?: (
    url: string,
    callback?: (status: string | { status: string }) => void,
  ) => void;
};

function webApp(): WebApp | undefined {
  return window.Telegram?.WebApp as WebApp | undefined;
}

/** t.me / telegram.me links only. */
export function openTelegramLink(url: string): void {
  const tg = webApp();
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

/** External URLs (Stripe, custom checkout, signed downloads). */
export function openExternalLink(url: string): void {
  const tg = webApp();
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export type InvoiceStatus = 'paid' | 'cancelled' | 'failed' | 'pending';

export function normalizeInvoiceStatus(raw: string | { status: string } | undefined): InvoiceStatus {
  const s = typeof raw === 'string' ? raw : raw?.status;
  if (s === 'paid' || s === 'cancelled' || s === 'failed' || s === 'pending') return s;
  return 'pending';
}

/**
 * Opens a Telegram Stars invoice. The callback may receive either a
 * string or an object depending on the WebApp SDK version — normalize
 * both.
 */
export function openInvoice(
  url: string,
  onDone: (status: InvoiceStatus) => void,
): void {
  const tg = webApp();
  if (!tg?.openInvoice) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  tg.openInvoice(url, (raw) => onDone(normalizeInvoiceStatus(raw)));
}
