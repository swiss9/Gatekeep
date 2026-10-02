import { useEffect, useState } from 'react';
import { api, type StoreSettings, type PaymentProvider } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { Banner } from '../../components/Banner';

type Draft = Omit<StoreSettings, 'id' | 'updated_at'>;

export function Settings() {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savingStore, setSavingStore] = useState(false);
  const [savingBanner, setSavingBanner] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [savingPerks, setSavingPerks] = useState(false);

  useEffect(() => {
    api
      .store()
      .then((s) => {
        const { id: _id, updated_at: _u, ...rest } = s.store;
        void _id;
        void _u;
        setDraft(rest);
      })
      .catch((err: unknown) => toast(err instanceof Error ? err.message : 'Load failed'));
  }, [toast]);

  if (!draft) return <p className="muted" style={{ marginTop: 16 }}>Loading…</p>;

  const save = async (
    keys: (keyof Draft)[],
    setBusy: (b: boolean) => void,
    okMsg: string,
  ) => {
    setBusy(true);
    try {
      const patch: Partial<Draft> = {};
      keys.forEach((k) => {
        (patch as Record<string, unknown>)[k] = draft[k];
      });
      const { store } = await api.updateSettings(patch);
      const { id: _id, updated_at: _u, ...rest } = store;
      void _id;
      void _u;
      setDraft(rest);
      toast(okMsg);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const PROVIDERS: { id: PaymentProvider; label: string; hint: string }[] = [
    {
      id: 'none',
      label: 'None',
      hint: 'No payment redirect. Orders sit in Pending payment until you confirm them manually.',
    },
    {
      id: 'stripe_link',
      label: 'Stripe Payment Link',
      hint: 'Paste a Stripe Payment Link URL. The order code is appended as client_reference_id.',
    },
    {
      id: 'ton',
      label: 'TON Wallet',
      hint: 'Buyers pay to your TON address. Requires pricing in TON — set the currency symbol to TON and price all products in TON. The order code is sent as the transaction memo.',
    },
    {
      id: 'custom',
      label: 'Custom URL',
      hint: 'Any URL. order and amount are appended as query params.',
    },
  ];

  return (
    <>
      <span className="section-title" style={{ display: 'block', marginTop: 22 }}>Store</span>
      <div className="panel">
        <div className="field">
          <label>Store name</label>
          <input type="text" value={draft.store_name} onChange={(e) => setDraft({ ...draft, store_name: e.target.value })} />
        </div>
        <div className="field">
          <label>Tagline</label>
          <input type="text" value={draft.store_tagline} onChange={(e) => setDraft({ ...draft, store_tagline: e.target.value })} />
        </div>
        <div className="field">
          <label>Currency symbol</label>
          <input type="text" maxLength={4} value={draft.currency_symbol} onChange={(e) => setDraft({ ...draft, currency_symbol: e.target.value })} />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Free shipping above</label>
            <input type="number" min="0" step="1" value={draft.shipping_threshold} onChange={(e) => setDraft({ ...draft, shipping_threshold: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>Shipping cost</label>
            <input type="number" min="0" step="0.5" value={draft.shipping_cost} onChange={(e) => setDraft({ ...draft, shipping_cost: Number(e.target.value) })} />
          </div>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={savingStore}
          onClick={() =>
            save(
              ['store_name', 'store_tagline', 'currency_symbol', 'shipping_threshold', 'shipping_cost'],
              setSavingStore,
              'Store saved',
            )
          }
        >
          {savingStore ? 'Saving…' : 'Save store'}
        </button>
      </div>

      <span className="section-title" style={{ display: 'block', marginTop: 26 }}>Payments</span>
      <div className="panel">
        <div className="field">
          <label>Provider</label>
          <select value={draft.payment_provider} onChange={(e) => setDraft({ ...draft, payment_provider: e.target.value as PaymentProvider })}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
            {PROVIDERS.find((p) => p.id === draft.payment_provider)?.hint}
          </p>
        </div>
        {draft.payment_provider === 'stripe_link' && (
          <div className="field">
            <label>Stripe Payment Link URL</label>
            <input type="text" value={draft.payment_url} onChange={(e) => setDraft({ ...draft, payment_url: e.target.value })} placeholder="https://buy.stripe.com/..." />
          </div>
        )}
        {draft.payment_provider === 'custom' && (
          <div className="field">
            <label>Custom checkout URL</label>
            <input type="text" value={draft.payment_url} onChange={(e) => setDraft({ ...draft, payment_url: e.target.value })} placeholder="https://your-provider.com/checkout" />
          </div>
        )}
        {draft.payment_provider === 'ton' && (
          <div className="field">
            <label>TON receiving address</label>
            <input type="text" value={draft.payment_ton_address} onChange={(e) => setDraft({ ...draft, payment_ton_address: e.target.value })} placeholder="UQ..." />
          </div>
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={savingPayment}
          onClick={() =>
            save(['payment_provider', 'payment_url', 'payment_ton_address'], setSavingPayment, 'Payments saved')
          }
        >
          {savingPayment ? 'Saving…' : 'Save payments'}
        </button>
      </div>

      <span className="section-title" style={{ display: 'block', marginTop: 26 }}>Product perks</span>
      <div className="panel">
        <div className="field" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ marginBottom: 0 }}>Show perks on product page</label>
          <label className="switch">
            <input type="checkbox" checked={draft.perks_enabled} onChange={(e) => setDraft({ ...draft, perks_enabled: e.target.checked })} />
            <span className="track" />
            <span className="knob" />
          </label>
        </div>
        {draft.perks_enabled && (
          <>
            <div className="field">
              <label>Perk 1</label>
              <input type="text" value={draft.perk_1_text} onChange={(e) => setDraft({ ...draft, perk_1_text: e.target.value })} />
            </div>
            <div className="field">
              <label>Perk 2</label>
              <input type="text" value={draft.perk_2_text} onChange={(e) => setDraft({ ...draft, perk_2_text: e.target.value })} />
            </div>
            <div className="field">
              <label>Perk 3</label>
              <input type="text" value={draft.perk_3_text} onChange={(e) => setDraft({ ...draft, perk_3_text: e.target.value })} />
            </div>
          </>
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={savingPerks}
          onClick={() =>
            save(['perks_enabled', 'perk_1_text', 'perk_2_text', 'perk_3_text'], setSavingPerks, 'Perks saved')
          }
        >
          {savingPerks ? 'Saving…' : 'Save perks'}
        </button>
      </div>

      <span className="section-title" style={{ display: 'block', marginTop: 26 }}>Home banner</span>
      <div className="panel">
        <div className="field" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ marginBottom: 0 }}>Show banner</label>
          <label className="switch">
            <input type="checkbox" checked={draft.banner_enabled} onChange={(e) => setDraft({ ...draft, banner_enabled: e.target.checked })} />
            <span className="track" />
            <span className="knob" />
          </label>
        </div>
        <div className="field"><label>Eyebrow</label><input type="text" value={draft.banner_eyebrow} onChange={(e) => setDraft({ ...draft, banner_eyebrow: e.target.value })} /></div>
        <div className="field"><label>Title</label><input type="text" value={draft.banner_title} onChange={(e) => setDraft({ ...draft, banner_title: e.target.value })} /></div>
        <div className="field"><label>Subtitle</label><input type="text" value={draft.banner_subtitle} onChange={(e) => setDraft({ ...draft, banner_subtitle: e.target.value })} /></div>
        <div className="field"><label>CTA label</label><input type="text" value={draft.banner_cta} onChange={(e) => setDraft({ ...draft, banner_cta: e.target.value })} /></div>
        <div className="field">
          <label>CTA action</label>
          <select value={draft.banner_cta_action} onChange={(e) => setDraft({ ...draft, banner_cta_action: e.target.value as Draft['banner_cta_action'] })}>
            <option value="all">Show all products</option>
            <option value="search">Focus search field</option>
            <option value="category">Show all products (category v2)</option>
          </select>
        </div>
        <div className="field">
          <label>Banner color</label>
          <div className="swatches">
            {(['mint', 'blue', 'pink', 'yellow', 'neutral'] as const).map((c) => {
              const bg =
                c === 'mint' ? '#D1FAE5'
                : c === 'blue' ? '#E0F2FE'
                : c === 'pink' ? '#FCE7F3'
                : c === 'yellow' ? '#FEF3C7'
                : '#EEEFF1';
              return (
                <label key={c} className={`swatch${draft.banner_color === c ? ' sel' : ''}`} style={{ background: bg }}>
                  <input type="radio" name="banner-color" checked={draft.banner_color === c} onChange={() => setDraft({ ...draft, banner_color: c })} />
                </label>
              );
            })}
          </div>
        </div>
        <div className="field">
          <label>Live preview</label>
          <Banner
            settings={{
              banner_color: draft.banner_color,
              banner_eyebrow: draft.banner_eyebrow,
              banner_title: draft.banner_title,
              banner_subtitle: draft.banner_subtitle,
              banner_cta: draft.banner_cta,
            }}
            onCta={() => undefined}
          />
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={savingBanner}
          onClick={() =>
            save(
              ['banner_enabled', 'banner_eyebrow', 'banner_title', 'banner_subtitle', 'banner_cta', 'banner_cta_action', 'banner_color'],
              setSavingBanner,
              'Banner saved',
            )
          }
        >
          {savingBanner ? 'Saving…' : 'Save banner'}
        </button>
      </div>
    </>
  );
}
