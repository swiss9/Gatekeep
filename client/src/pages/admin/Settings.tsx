import { useEffect, useState } from 'react';
import { api, type StoreSettings } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { Banner } from '../../components/Banner';

type Draft = Omit<StoreSettings, 'id' | 'updated_at'>;

export function Settings() {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    api
      .store()
      .then((s) => {
        const { id: _id, updated_at: _u, ...rest } = s.store;
        void _id;
        void _u;
        setDraft({
          ...rest,
          shipping_threshold: Number(rest.shipping_threshold),
          shipping_cost: Number(rest.shipping_cost),
          stars_rate: Number(rest.stars_rate),
        });
      })
      .catch((err: unknown) => toast(err instanceof Error ? err.message : 'Load failed'));
  }, [toast]);

  if (!draft) return <p className="muted" style={{ marginTop: 16 }}>Loading…</p>;

  const save = async (keys: (keyof Draft)[], card: string, okMsg: string) => {
    setSaving(card);
    try {
      const patch: Partial<Draft> = {};
      keys.forEach((k) => {
        (patch as Record<string, unknown>)[k] = draft[k];
      });
      const { store } = await api.updateSettings(patch);
      const { id: _id, updated_at: _u, ...rest } = store;
      void _id;
      void _u;
      setDraft({
        ...rest,
        shipping_threshold: Number(rest.shipping_threshold),
        shipping_cost: Number(rest.shipping_cost),
        stars_rate: Number(rest.stars_rate),
      });
      toast(okMsg);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(null);
    }
  };

  const update = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });

  const starsExample = Math.round(10 * (draft.stars_rate || 77));

  return (
    <>
      <span className="section-title" style={{ display: 'block', marginTop: 22 }}>Store</span>
      <div className="panel">
        <div className="field">
          <label>Store name</label>
          <input
            type="text"
            value={draft.store_name}
            onChange={(e) => update('store_name', e.target.value)}
          />
        </div>
        <div className="field">
          <label>Tagline</label>
          <input
            type="text"
            value={draft.store_tagline}
            onChange={(e) => update('store_tagline', e.target.value)}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Currency symbol</label>
            <input
              type="text"
              maxLength={4}
              value={draft.currency_symbol}
              onChange={(e) => update('currency_symbol', e.target.value)}
              placeholder="$"
            />
          </div>
          <div className="field">
            <label>Currency code</label>
            <input
              type="text"
              maxLength={3}
              value={draft.currency_code}
              onChange={(e) => update('currency_code', e.target.value.toLowerCase())}
              placeholder="usd"
            />
          </div>
        </div>
        <p className="muted" style={{ fontSize: 11.5, marginTop: -4, marginBottom: 8 }}>
          Currency code is used by Stripe (3-letter ISO, e.g. <code>usd</code>, <code>eur</code>, <code>gbp</code>).
        </p>
        <div className="field-row">
          <div className="field">
            <label>Free shipping above</label>
            <input
              type="number"
              min="0"
              step="1"
              value={draft.shipping_threshold}
              onChange={(e) => update('shipping_threshold', Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label>Shipping cost</label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={draft.shipping_cost}
              onChange={(e) => update('shipping_cost', Number(e.target.value))}
            />
          </div>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={saving === 'store'}
          onClick={() =>
            save(
              ['store_name', 'store_tagline', 'currency_symbol', 'currency_code', 'shipping_threshold', 'shipping_cost'],
              'store',
              'Store saved',
            )
          }
        >
          {saving === 'store' ? 'Saving…' : 'Save store'}
        </button>
      </div>

      <span className="section-title" style={{ display: 'block', marginTop: 26 }}>Payments</span>

      <div className="panel">
        <div className="field" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Telegram Stars</div>
            <p className="muted" style={{ fontSize: 11.5 }}>
              Buyers pay inside Telegram. Confirmation is automatic.
            </p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={draft.stars_enabled}
              onChange={(e) => update('stars_enabled', e.target.checked)}
            />
            <span className="track" />
            <span className="knob" />
          </label>
        </div>
        {draft.stars_enabled && (
          <div className="field">
            <label>Stars per 1 {draft.currency_symbol}</label>
            <input
              type="number"
              min="1"
              step="1"
              value={draft.stars_rate}
              onChange={(e) => update('stars_rate', Number(e.target.value))}
            />
            <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
              Conversion rate. A {draft.currency_symbol}10 product will cost{' '}
              <b>{starsExample.toLocaleString()} Stars</b>.
            </p>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="field" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Card (Stripe)</div>
            <p className="muted" style={{ fontSize: 11.5 }}>
              Per-order Stripe Checkout. Requires server keys. Confirmation is automatic.
            </p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={draft.stripe_enabled}
              onChange={(e) => update('stripe_enabled', e.target.checked)}
            />
            <span className="track" />
            <span className="knob" />
          </label>
        </div>
      </div>

      <div className="panel">
        <div className="field" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Bank transfer</div>
            <p className="muted" style={{ fontSize: 11.5 }}>
              Buyer transfers money, uploads a receipt, you confirm manually.
            </p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={draft.bank_enabled}
              onChange={(e) => update('bank_enabled', e.target.checked)}
            />
            <span className="track" />
            <span className="knob" />
          </label>
        </div>
        {draft.bank_enabled && (
          <div className="field">
            <label>Bank details (shown to buyer)</label>
            <textarea
              value={draft.bank_details}
              onChange={(e) => update('bank_details', e.target.value)}
              placeholder={`Bank: Chase\nAccount name: Your Store LLC\nIBAN / Account: GB29 NWBK …\nSWIFT / BIC: CHASUS33`}
              style={{ minHeight: 120 }}
            />
          </div>
        )}
      </div>

      <div className="panel">
        <div className="field" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Cash on Delivery</div>
            <p className="muted" style={{ fontSize: 11.5 }}>
              Buyer pays cash when the order arrives. Only useful for physical goods.
            </p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={draft.cod_enabled}
              onChange={(e) => update('cod_enabled', e.target.checked)}
            />
            <span className="track" />
            <span className="knob" />
          </label>
        </div>
      </div>

      <div className="panel">
        <div className="field" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Crypto</div>
            <p className="muted" style={{ fontSize: 11.5 }}>
              Buyer sends to one of your wallets and submits a tx hash. Leave an address blank to hide it.
            </p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={draft.crypto_enabled}
              onChange={(e) => update('crypto_enabled', e.target.checked)}
            />
            <span className="track" />
            <span className="knob" />
          </label>
        </div>
        {draft.crypto_enabled && (
          <>
            <div className="field">
              <label>BTC address</label>
              <input type="text" value={draft.crypto_btc} onChange={(e) => update('crypto_btc', e.target.value)} placeholder="bc1q…" />
            </div>
            <div className="field">
              <label>ETH address</label>
              <input type="text" value={draft.crypto_eth} onChange={(e) => update('crypto_eth', e.target.value)} placeholder="0x…" />
            </div>
            <div className="field">
              <label>USDT TRC20 address</label>
              <input type="text" value={draft.crypto_usdt_trc20} onChange={(e) => update('crypto_usdt_trc20', e.target.value)} placeholder="T…" />
            </div>
            <div className="field">
              <label>TON address</label>
              <input type="text" value={draft.crypto_ton} onChange={(e) => update('crypto_ton', e.target.value)} placeholder="UQ…" />
            </div>
          </>
        )}
      </div>

      <button
        type="button"
        className="btn-primary"
        disabled={saving === 'payments'}
        onClick={() =>
          save(
            [
              'stars_enabled',
              'stars_rate',
              'stripe_enabled',
              'bank_enabled',
              'bank_details',
              'cod_enabled',
              'crypto_enabled',
              'crypto_btc',
              'crypto_eth',
              'crypto_usdt_trc20',
              'crypto_ton',
            ],
            'payments',
            'Payment settings saved',
          )
        }
      >
        {saving === 'payments' ? 'Saving…' : 'Save payment settings'}
      </button>

      <span className="section-title" style={{ display: 'block', marginTop: 26 }}>Product perks</span>
      <div className="panel">
        <div className="field" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ marginBottom: 0 }}>Show perks on product page</label>
          <label className="switch">
            <input
              type="checkbox"
              checked={draft.perks_enabled}
              onChange={(e) => update('perks_enabled', e.target.checked)}
            />
            <span className="track" />
            <span className="knob" />
          </label>
        </div>
        {draft.perks_enabled && (
          <>
            <div className="field">
              <label>Perk 1 (leave blank to hide)</label>
              <input type="text" value={draft.perk_1_text} onChange={(e) => update('perk_1_text', e.target.value)} />
            </div>
            <div className="field">
              <label>Perk 2 (leave blank to hide)</label>
              <input type="text" value={draft.perk_2_text} onChange={(e) => update('perk_2_text', e.target.value)} />
            </div>
            <div className="field">
              <label>Perk 3 (leave blank to hide)</label>
              <input type="text" value={draft.perk_3_text} onChange={(e) => update('perk_3_text', e.target.value)} />
            </div>
          </>
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={saving === 'perks'}
          onClick={() =>
            save(
              ['perks_enabled', 'perk_1_text', 'perk_2_text', 'perk_3_text'],
              'perks',
              'Perks saved',
            )
          }
        >
          {saving === 'perks' ? 'Saving…' : 'Save perks'}
        </button>
      </div>

      <span className="section-title" style={{ display: 'block', marginTop: 26 }}>Home banner</span>
      <div className="panel">
        <div className="field" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ marginBottom: 0 }}>Show banner</label>
          <label className="switch">
            <input
              type="checkbox"
              checked={draft.banner_enabled}
              onChange={(e) => update('banner_enabled', e.target.checked)}
            />
            <span className="track" />
            <span className="knob" />
          </label>
        </div>
        <div className="field"><label>Eyebrow</label><input type="text" value={draft.banner_eyebrow} onChange={(e) => update('banner_eyebrow', e.target.value)} /></div>
        <div className="field"><label>Title</label><input type="text" value={draft.banner_title} onChange={(e) => update('banner_title', e.target.value)} /></div>
        <div className="field"><label>Subtitle</label><input type="text" value={draft.banner_subtitle} onChange={(e) => update('banner_subtitle', e.target.value)} /></div>
        <div className="field"><label>CTA label</label><input type="text" value={draft.banner_cta} onChange={(e) => update('banner_cta', e.target.value)} /></div>
        <div className="field">
          <label>CTA action</label>
          <select
            value={draft.banner_cta_action}
            onChange={(e) => update('banner_cta_action', e.target.value as Draft['banner_cta_action'])}
          >
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
                <label
                  key={c}
                  className={`swatch${draft.banner_color === c ? ' sel' : ''}`}
                  style={{ background: bg }}
                >
                  <input
                    type="radio"
                    name="banner-color"
                    checked={draft.banner_color === c}
                    onChange={() => update('banner_color', c)}
                  />
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
          disabled={saving === 'banner'}
          onClick={() =>
            save(
              ['banner_enabled', 'banner_eyebrow', 'banner_title', 'banner_subtitle', 'banner_cta', 'banner_cta_action', 'banner_color'],
              'banner',
              'Banner saved',
            )
          }
        >
          {saving === 'banner' ? 'Saving…' : 'Save banner'}
        </button>
      </div>
    </>
  );
    }
