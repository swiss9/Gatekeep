import type { StoreSettings } from '../lib/api';

type Props = {
  settings: Pick<
    StoreSettings,
    | 'banner_color'
    | 'banner_eyebrow'
    | 'banner_title'
    | 'banner_subtitle'
    | 'banner_cta'
  >;
  onCta: () => void;
};

export function Banner({ settings, onCta }: Props) {
  return (
    <div className={`banner ${settings.banner_color}`}>
      <div>
        {settings.banner_eyebrow && <span className="eyebrow">{settings.banner_eyebrow}</span>}
        <h3 className="h-display">{settings.banner_title}</h3>
        <p>{settings.banner_subtitle}</p>
      </div>
      {settings.banner_cta && (
        <button type="button" className="banner-btn" onClick={onCta}>
          {settings.banner_cta}
        </button>
      )}
    </div>
  );
}
