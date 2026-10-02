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
};

function webApp(): WebApp | undefined {
  return window.Telegram?.WebApp as WebApp | undefined;
}

/**
 * t.me / telegram.me links only. Telegram rejects anything else with
 * this method. Use openExternalLink for everything else.
 */
export function openTelegramLink(url: string): void {
  const tg = webApp();
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * External URLs (Stripe, custom checkout, signed downloads). Uses
 * WebApp.openLink which opens in the in-app browser on mobile. Falls
 * back to window.open on desktop / browser.
 */
export function openExternalLink(url: string): void {
  const tg = webApp();
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
