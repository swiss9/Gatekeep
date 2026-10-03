import { useEffect, useState } from 'react';
import {
  api,
  formatMoney,
  uploadReceipt,
  VALIDATION,
  type Order,
  type StoreSettings,
} from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useRouter } from '../App';

type Props = { orderCode: string };

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; order: Order; store: StoreSettings };

type Download = { product_name: string; signed_url: string };

const POLL_INTERVAL_MS = 5000;
const POLL_MAX_MS = 15 * 60 * 1000;

export function OrderConfirmation({ orderCode }: Props) {
  const { navigate } = useRouter();
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [note, setNote] = useState('');
  const [txHash, setTxHash] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [downloads, setDownloads] = useState<Download[] | null>(null);
  const [loadingDownloads, setLoadingDownloads] = useState(false);

  const load = async (): Promise<State> => {
    const [ordersRes, storeRes] = await Promise.all([api.myOrders(), api.store()]);
    const order = ordersRes.orders.find((o) => o.order_code === orderCode);
    if (!order) return { kind: 'error', message: 'Order not found.' };
    return { kind: 'ready', order, store: storeRes.store };
  };

  useEffect(() => {
    let cancelled = false;
    load().then((next) => { if (!cancelled) setState(next); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load.' });
      });
    return () => { cancelled = true; };
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
      if (Date.now() - started > POLL_MAX_MS) { window.clearInterval(tick); return; }
      try { setState(await load()); } catch { /* silent */ }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPoll]);

  const refresh = async () => {
    setRefreshing(true);
    try { setState(await load()); }
    catch (err) { toast(err instanceof Error ? err.message : 'Refresh failed'); }
    finally { setRefreshing(false); }
  };

  const loadDownloads = async () => {
    if (state.kind !== 'ready') return;
    setLoadingDownloads(true);
    try {
      const { downloads: dls } = await api.orderDownloads(state.order.id);
      setDownloads(dls);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No downloads available');
    } finally {
      setLoadingDownloads(false);
    }
  };

  const currency = state.kind === 'ready' ? state.store.currency_symbol : '$';
  const method = state.kind === 'ready' ? state.order.payment_method : '';
  const isPaid =
    state.kind === 'ready' &&
    state.order.status !== 'Pending payment' &&
    state.order.status !== 'Cancelled';
  const isCancelled = state.kind === 'ready' && state.order.status === 'Cancelled';
  const proofSubmitted = state.kind === 'ready' && !!state.order.payment_proof_submitted_at;

  const onFile = (f: File | null) => setReceiptFile(f);
  const clearFile = () => setReceiptFile(null);

  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); toast(`${label} copied`); }
    catch { toast('Copy failed'); }
  };

  const submitProof = async () => {
    if (state.kind !== 'ready') return;
    if (!note.trim() && !txHash.trim() && !receiptFile) {
      toast('Add a note, tx hash, or receipt');
      return;
    }
    if (txHash.trim() && !VALIDATION.TX_RE.test(txHash.trim())) {
      toast('Transaction hash looks invalid');
      return;
    }
    setSubmitting(true);
    try {
      let proofPath: string | undefined;
      if (receiptFile) {
        setUploading(true);
        proofPath = await uploadReceipt(receiptFile, state.order.id);
        setUploading(false);
      }
      await api.submitProof(state.order.id, {
        note: note.trim(),
        tx_hash: txHash.trim(),
        proof_url: proofPath,
      });
      toast('Proof submitted — the seller will confirm shortly');
      setState(await load());
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
    return <section className="screen active"><div className="center-state">Loading order…</div></section>;
  }
  if (state.kind === 'error') {
    return <section className="screen active"><div className="center-state">{state.message}</div></section>;
  }

  const { order } = state;

  const headline = isPaid
    ? 'Paid in full'
    : isCancelled
      ? 'Order cancelled'
      : proofSubmitted
        ? 'Awaiting confirmation'
        : 'Awaiting payment';

  const subline = isPaid
    ? "We'll message you on Telegram when your order ships."
    : isCancelled
      ? 'This order was cancelled. No payment was taken.'
      : proofSubmitted
        ? 'Proof received. The seller will confirm your payment shortly.'
        : `Total ${formatMoney(order.total, currency)}`;

  return (
    <section className="screen active">
      <div className="success-wrap" style={{ minHeight: isPaid ? '78dvh' : 'auto', paddingTop: 24 }}>
        <div className="success-icon" style={isCancelled ? { background: '#FEE2E2' } : undefined}>
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
          {isPaid ? 'Payment received' : isCancelled ? 'Order cancelled' : proofSubmitted ? 'Under review' : 'Order placed'}
        </span>
        <h2 className="h-display" style={{ fontSize: 26, marginTop: 6 }}>{headline}</h2>
        <span className="success-id">#{order.order_code}</span>
        <p className="msg" style={{ maxWidth: 320 }}>{subline}</p>
      </div>

      {/* Downloads for paid digital orders */}
      {isPaid && order.status === 'Delivered' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>
            Your downloads
          </span>
          {downloads === null ? (
            <button
              type="button"
              className="btn-primary"
              style={{ height: 44, fontSize: 14 }}
              disabled={loadingDownloads}
              onClick={loadDownloads}
            >
              {loadingDownloads ? 'Fetching…' : 'Show download links'}
            </button>
          ) : downloads.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>No downloadable items in this order.</p>
          ) : (
            downloads.map((d, i) => (
              <div
                key={i}
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  marginBottom: 8,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{d.product_name}</div>
                <a href={d.signed_url} target="_blank" rel="noreferrer" className="link-btn">
                  Download (24h link)
                </a>
              </div>
            ))
          )}
        </div>
      )}

      {/* Stars pending */}
      {!isPaid && !isCancelled && method === 'stars' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>Telegram Stars</span>
          <p className="muted" style={{ fontSize: 13 }}>
            Waiting for Telegram to confirm your Stars payment. This page updates automatically.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button type="button" className="btn-primary" style={{ height: 44, fontSize: 14 }} disabled={refreshing} onClick={refresh}>
              {refreshing ? 'Checking…' : 'Refresh status'}
            </button>
            {order.payment_redirect_url && (
              <button
                type="button"
                className="btn-primary"
                style={{ height: 44, fontSize: 14, background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)' }}
                onClick={() => window.open(order.payment_redirect_url ?? '', '_blank')}
              >
                Re-open invoice
              </button>
            )}
          </div>
        </div>
      )}

      {/* Stripe pending */}
      {!isPaid && !isCancelled && method === 'stripe' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>Card payment</span>
          <p className="muted" style={{ fontSize: 13 }}>
            Waiting for Stripe to confirm your payment. This page updates automatically.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button type="button" className="btn-primary" style={{ height: 44, fontSize: 14 }} disabled={refreshing} onClick={refresh}>
              {refreshing ? 'Checking…' : 'Refresh status'}
            </button>
            {order.payment_redirect_url && (
              <button
                type="button"
                className="btn-primary"
                style={{ height: 44, fontSize: 14, background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)' }}
                onClick={() => window.open(order.payment_redirect_url ?? '', '_blank')}
              >
                Re-open checkout
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bank */}
      {!isPaid && !isCancelled && method === 'bank' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>Bank transfer</span>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            Send {formatMoney(order.total, currency)} to the account below, then submit
            proof. Include the order code as the reference.
          </p>
          <div style={{ background: 'var(--chip)', borderRadius: 10, padding: '12px 14px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {state.store.bank_details || '—'}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" className="link-btn" onClick={() => copy(state.store.bank_details, 'Details')}>Copy details</button>
            <button type="button" className="link-btn" onClick={() => copy(order.order_code, 'Order code')}>Copy reference</button>
          </div>
        </div>
      )}

      {/* Crypto */}
      {!isPaid && !isCancelled && method === 'crypto' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>Crypto payment</span>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            Send {formatMoney(order.total, currency)} worth to one address below, then submit the tx hash.
          </p>
          {[
            { label: 'BTC', value: state.store.crypto_btc },
            { label: 'ETH', value: state.store.crypto_eth },
            { label: 'USDT (TRC20)', value: state.store.crypto_usdt_trc20 },
            { label: 'TON', value: state.store.crypto_ton },
          ].filter((a) => a.value.trim()).map((a) => (
            <div key={a.label} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>{a.label}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, wordBreak: 'break-all', marginTop: 4 }}>{a.value}</div>
              <button type="button" className="link-btn" style={{ marginTop: 6 }} onClick={() => copy(a.value, a.label)}>Copy address</button>
            </div>
          ))}
        </div>
      )}

      {/* COD */}
      {!isPaid && !isCancelled && method === 'cod' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>Cash on Delivery</span>
          <p className="muted" style={{ fontSize: 13 }}>
            Pay {formatMoney(order.total, currency)} in cash when your order arrives. We'll message you on Telegram to arrange delivery.
          </p>
        </div>
      )}

      {/* Manual */}
      {!isPaid && !isCancelled && method === 'manual' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>Arrange with seller</span>
          <p className="muted" style={{ fontSize: 13 }}>
            We'll message you on Telegram to arrange payment and delivery. Use the field below if you have any instructions.
          </p>
        </div>
      )}

      {/* Proof form — hidden once proof is submitted */}
      {!isPaid && !isCancelled && !proofSubmitted &&
        (method === 'bank' || method === 'crypto' || method === 'manual') && (
          <div className="panel" style={{ marginTop: 14 }}>
            <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>Proof of payment</span>

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
              <label>{method === 'manual' ? 'Note for the seller' : 'Note (optional)'}</label>
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
              {!receiptFile ? (
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                  disabled={uploading}
                />
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    background: 'var(--chip)',
                  }}
                >
                  <span className="muted" style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {receiptFile.name}
                  </span>
                  <button
                    type="button"
                    className="x-btn"
                    aria-label="Remove file"
                    onClick={clearFile}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            <button type="button" className="btn-primary" disabled={submitting || uploading} onClick={submitProof}>
              {uploading ? 'Uploading…' : submitting ? 'Submitting…' : 'Submit proof'}
            </button>
          </div>
        )}

      {proofSubmitted && !isPaid && !isCancelled && (
        <div className="panel" style={{ marginTop: 14 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>Proof submitted</span>
          <p className="muted" style={{ fontSize: 13 }}>
            Received on {new Date(order.payment_proof_submitted_at ?? '').toLocaleString()}. The seller
            will confirm shortly — you'll get a Telegram message when they do.
          </p>
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
