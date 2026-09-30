export function getInitData(): string {
  return window.Telegram?.WebApp?.initData ?? '';
}

export function getStartParam(): string | undefined {
  return window.Telegram?.WebApp?.initDataUnsafe?.start_param;
}

export function haptic(style: 'light' | 'medium' | 'heavy' = 'light'): void {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
}

export function openTelegramLink(url: string): void {
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
