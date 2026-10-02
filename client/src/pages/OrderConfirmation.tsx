import { useEffect, useMemo, useState } from 'react';
import {
  api,
  formatMoney,
  uploadReceipt,
  type Order,
  type StoreSettings,
} from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useRouter } from '../App';

type Props = { orderCode: string };

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; order: Order; store: StoreSettings };

const POLL_INTERVAL_MS = 5000;
// 15 minutes. Stripe's own session lives 24h, and bank buyers may take
// much longer than that. The manual Refresh button covers anything past
// this window.
const POLL_MAX_MS = 15 * 60 * 1000;

export function OrderConfirmation({ orderCode }: Props) {
  const { navigate } = useRouter();
  const auth = useAuth();
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [note, setNote] = useState('');
  const [txHash, setTxHash] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (): Promise<State> => {
    const [ordersRes, storeRes] = await Promise.all([api.myOrders(), api.store()]);
    const order = ordersRes.orders.find((o) => o.order_code === orderCode);
    if (!order) return { kind: 'error', message: 'Order not found.' };
    return { kind: 'ready', order, store: storeRes.store };
  };

  useEffect(() => {
    let cancelled = false;
    load()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Failed to load.',
        });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderCode]);

  const shouldPoll =
    state.kind === 'ready' &&
    state.order.status === 'Pending payment' &&
    (state.order.payment_method === 'stars' || state.order.payment_method === 'stripe');

  useEffect(() => {
    if (!shouldPoll) return;
    const started = Date.now();
    const tick = window.setInterval(async () => {
      if (Date.now() - started > POLL_MAX_MS) {
        window.clearInterval(tick);
        return;
      }
      try {
        const next = await load();
        setState(next);
      } catch {
        // Silent — polling is best-effort.
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPoll]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const next = await load();
      setState(next);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const currency = state.kind === 'ready' ? state.store.currency_symbol : '$';
  const method = state.kind === 'ready' ? state.order.payment_method : '';

  const isPaid =
    state.kind === 'ready' &&
    state.order.status !== 'Pending payment' &&
    state.order.status !== 'Cancelled';
  const isCancelled = state.kind === 'ready' && state.order.status === 'Cancelled';

  const activeCryptoAddresses = useMemo(() => {
    if (state.kind !== 'ready') return [];
    const s = state.store;
    return [
      { label: 'BTC', value: s.crypto_btc },
      { label: 'ETH', value: s.crypto_eth },
      { label: 'USDT (TRC20)', value: s.crypto_usdt_trc20 },
      { label: 'TON', value: s.crypto_ton },
    ].filter((a) => a.value.trim().length > 0);
  }, [state]);

  const onFile = (f: File | null) => {
    setReceiptFile(f);
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${label} copied`);
    } catch {
      toast('Copy failed');
    }
  };

  const submitProof = async () => {
    if (state.kind !== 'ready') return;
    if (!note.trim() && !txHash.trim() && !receiptFile) {
      toast('Add a note, tx hash, or receipt');
      return;
    }
    if (!auth || auth.status !== 'ready') {
      toast('Not authenticated');
      return;
    }
    setSubmitting(true);
    try {
      let proofPath: string | undefined;
      if (receiptFile) {
        setUploading(true);
        proofPath = await uploadReceipt(receiptFile, auth.profile.id, state.order.id);
        setUploading(false);
      }
      await api.submitProof(state.order.id, {
        note: note.trim(),
        tx_hash: txHash.trim(),
        proof_url: proofPath,
      });
      toast('Proof submitted — the seller will confirm shortly');
      const next = await load();
      setState(next);
      // Clear the form so a correction submission starts fresh.
      setNote('');
      setTxHash('');
      setReceiptFile(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
      setUploading(false);
    }
  };

  if (state.kind === 'loading') {
    return (
      <section className="screen active">
        <div className="center-state">Loading order…</div>
      </section>
    );
  }
  if (state.kind === 'error') {
    return (
      <section className="screen active">
        <div className="center-state">{state.message}</div>
      </section>
    );
  }

  const { order } = state;

  return (
    <section className="screen active">
      <div
        className="success-wrap"
        style={{ minHeight: isPaid ? '78dvh' : 'auto', paddingTop: 24 }}
      >
        <div
          className="success-icon"
          style={isCancelled ? { background: '#FEE2E2' } : undefined}
        >
          {isPaid ? (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#111111" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="m4.5 12.5 5 5L19.5 7" />
            </svg>
          ) : isCancelled ? (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#B91C1C" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          ) : (
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#111111" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          )}
        </div>
        <span className="eyebrow muted">
          {isPaid ? 'Payment received' : isCancelled ? 'Order cancelled' : 'Order placed'}
        </span>
        <h2 className="h-display" style={{ fontSize: 26, marginTop: 6 }}>
          {isPaid ? 'Paid in full' : isCancelled ? 'Order cancelled' : 'Awaiting payment'}
        </h2>
        <span className="success-id">#{order.order_code}</span>
        <p className="msg" style={{ maxWidth: 300 }}>
          {isPaid
            ? "We'll message you on Telegram when your order ships."
            : isCancelled
              ? 'This order was cancelled. No payment was taken.'
              : `Total ${formatMoney(order.total, currency)}`}
        </p>
      </div>

      {/* ---------- Stars pending ---------- */}
      {!isPaid && !isCancelled && method === 'stars' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>
            Telegram Stars
          </span>
          <p className="muted" style={{ fontSize: 13 }}>
            Waiting for Telegram to confirm your Stars payment. This page
            updates automatically.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              type="button"
              className="btn-primary"
              style={{ height: 44, fontSize: 14 }}
              disabled={refreshing}
              onClick={refresh}
            >
              {refreshing ? 'Checking…' : 'Refresh status'}
            </button>
            {order.payment_redirect_url && (
              <button
                type="button"
                className="btn-primary"
                style={{
                  height: 44,
                  fontSize: 14,
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  border: '1px solid var(--line)',
                }}
                onClick={() => window.open(order.payment_redirect_url ?? '', '_blank')}
              >
                Re-open invoice
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---------- Stripe pending ---------- */}
      {!isPaid && !isCancelled && method === 'stripe' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>
            Card payment
          </span>
          <p className="muted" style={{ fontSize: 13 }}>
            Waiting for Stripe to confirm your payment. This page updates
            automatically.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              type="button"
              className="btn-primary"
              style={{ height: 44, fontSize: 14 }}
              disabled={refreshing}
              onClick={refresh}
            >
              {refreshing ? 'Checking…' : 'Refresh status'}
            </button>
            {order.payment_redirect_url && (
              <button
                type="button"
                className="btn-primary"
                style={{
                  height: 44,
                  fontSize: 14,
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  border: '1px solid var(--line)',
                }}
                onClick={() => window.open(order.payment_redirect_url ?? '', '_blank')}
              >
                Re-open checkout
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---------- Bank ---------- */}
      {!isPaid && !isCancelled && method === 'bank' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>
            Bank transfer
          </span>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            Send {formatMoney(order.total, currency)} to the account below,
            then submit proof of payment. Include the order code as the
            reference.
          </p>
          <div
            style={{
              background: 'var(--chip)',
              borderRadius: 10,
              padding: '12px 14px',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {state.store.bank_details || '—'}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              type="button"
              className="link-btn"
              onClick={() => copy(state.store.bank_details, 'Details')}
            >
              Copy details
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={() => copy(order.order_code, 'Order code')}
            >
              Copy reference
            </button>
          </div>
        </div>
      )}

      {/* ---------- Crypto ---------- */}
      {!isPaid && !isCancelled && method === 'crypto' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>
            Crypto payment
          </span>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            Send the equivalent of {formatMoney(order.total, currency)} to one
            of the addresses below. Then submit the transaction hash.
          </p>
          {activeCryptoAddresses.length === 0 ? (
            <p className="muted" style={{ fontSize: 12.5 }}>
              No wallet addresses configured. Contact the seller.
            </p>
          ) : (
            activeCryptoAddresses.map((a) => (
              <div
                key={a.label}
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--muted)',
                  }}
                >
                  {a.label}
                </div>
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11.5,
                    wordBreak: 'break-all',
                    marginTop: 4,
                  }}
                >
                  {a.value}
                </div>
                <button
                  type="button"
                  className="link-btn"
                  style={{ marginTop: 6 }}
                  onClick={() => copy(a.value, a.label)}
                >
                  Copy address
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* ---------- COD ---------- */}
      {!isPaid && !isCancelled && method === 'cod' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>
            Cash on Delivery
          </span>
          <p className="muted" style={{ fontSize: 13 }}>
            Pay {formatMoney(order.total, currency)} in cash when your order
            arrives. We'll message you on Telegram to arrange delivery.
          </p>
        </div>
      )}

      {/* ---------- Manual ---------- */}
      {!isPaid && !isCancelled && method === 'manual' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>
            Arrange with seller
          </span>
          <p className="muted" style={{ fontSize: 13 }}>
            We'll message you on Telegram to arrange payment and delivery.
            Use the field below if you have any instructions for us.
          </p>
        </div>
      )}

      {/* ---------- Proof form ---------- */}
      {!isPaid &&
        !isCancelled &&
        (method === 'bank' || method === 'crypto' || method === 'manual') && (
          <div className="panel" style={{ marginTop: 14 }}>
            <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>
              Proof of payment
            </span>

            {method === 'crypto' && (
              <div className="field">
                <label>Transaction hash</label>
                <input
                  type="text"
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value)}
                  placeholder="0x… or chain-specific hash"
                />
              </div>
            )}

            <div className="field">
              <label>
                {method === 'manual' ? 'Note for the seller' : 'Note (optional)'}
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  method === 'bank'
                    ? 'Sent from XYZ bank, ref #12345'
                    : method === 'crypto'
                      ? 'Sent from wallet 0x…'
                      : 'Any details we should know'
                }
              />
            </div>

            <div className="field">
              <label>Receipt image (optional)</label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                disabled={uploading}
              />
              {receiptFile && (
                <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                  {receiptFile.name}
                </p>
              )}
            </div>

            <button
              type="button"
              className="btn-primary"
              disabled={submitting || uploading}
              onClick={submitProof}
            >
              {uploading ? 'Uploading…' : submitting ? 'Submitting…' : 'Submit proof'}
            </button>
          </div>
        )}

      <button
        type="button"
        className="btn-primary"
        style={{ maxWidth: 300, marginTop: 26 }}
        onClick={() => navigate({ name: 'shop' })}
      >
        {isPaid ? 'Continue shopping' : 'Back to shop'}
      </button>
    </section>
  );
               }
