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
  | { kind: 'ready'; order: Order; store: StoreSettings; supportUsername: string | null };

type Download = {
  product_name: string;
  file_index: number;
  file_total: number;
  signed_url: string;
};

const POLL_INTERVAL_MS = 5000;
const POLL_MAX_MS = 15 * 60 * 1000;

/**
 * The message the buyer sends the seller via the "Message seller" button.
 * Method-specific so the seller has context the moment the chat opens.
 */
function telegramMessageFor(method: string, orderCode: string, total: string): string {
  switch (method) {
    case 'manual':
      return `Hi, I'd like to buy order #${orderCode}. I want to arrange payment with you.`;
    case 'bank':
      return `Hi, I'm paying for order #${orderCode} (${total}) by bank transfer. Please confirm.`;
    case 'crypto':
      return `Hi, I'd like to pay for order #${orderCode} (${total}) in crypto. Please confirm.`;
    case 'cod':
      return `Hi, I'd like order #${orderCode} (${total}) delivered with Cash on Delivery.`;
    default:
      return `Hi, I have a question about order #${orderCode} (${total}).`;
  }
}

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
    return {
      kind: 'ready',
      order,
      store: storeRes.store,
      supportUsername: storeRes.support_username,
    };
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
        setState(await load());
      } catch {
        /* silent */
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPoll]);

  const isPaid =
    state.kind === 'ready' &&
    state.order.status !== 'Pending payment' &&
    state.order.status !== 'Cancelled';
  const isCancelled = state.kind === 'ready' && state.order.status === 'Cancelled';

  // Auto-load downloads once paid — no extra tap.
  useEffect(() => {
    if (!isPaid || state.kind !== 'ready') return;
    if (downloads !== null) return;
    let cancelled = false;
    setLoadingDownloads(true);
    api
      .orderDownloads(state.order.id)
      .then(({ downloads: dls }) => {
        if (!cancelled) setDownloads(dls);
      })
      .catch(() => {
        if (!cancelled) setDownloads([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingDownloads(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaid]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      setState(await load());
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const reloadDownloads = async () => {
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
  const proofSubmitted = state.kind === 'ready' && !!state.order.payment_proof_submitted_at;

  const clearFile = () => setReceiptFile(null);

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

  const { order, supportUsername } = state;

  const headline = isPaid
    ? 'Paid in full'
    : isCancelled
      ? 'Order cancelled'
      : proofSubmitted
        ? 'Awaiting confirmation'
        : 'Awaiting payment';

  const hasDownloads = downloads !== null && downloads.length > 0;
  const subline = isPaid
    ? hasDownloads
      ? "Your downloads are below. We'll message you on Telegram if anything ships."
      : "We'll message you on Telegram when your order ships."
    : isCancelled
      ? 'This order was cancelled. No payment was taken.'
      : proofSubmitted
        ? 'Proof received. The seller will confirm your payment shortly.'
        : `Total ${formatMoney(order.total, currency)}`;

  const totalLabel = formatMoney(order.total, currency);
  const telegramMessage = telegramMessageFor(method, order.order_code, totalLabel);
  const telegramDeepLink = supportUsername
    ? `https://t.me/${supportUsername}?text=${encodeURIComponent(telegramMessage)}`
    : null;

  /** Small "Message seller" block reused under bank/crypto/cod panels. */
  const SellerContact = () => {
    if (!telegramDeepLink) return null;
    return (
      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px solid var(--line)',
        }}
      >
        <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Need to reach the seller about this payment?
        </p>
        <a
          href={telegramDeepLink}
          target="_blank"
          rel="noreferrer"
          className="link-btn"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21.9 4.3 2.5 11.7c-1 .4-1 1.8 0 2.2l4.7 1.6 1.8 5.7c.3.9 1.4 1.1 2 .5l2.6-2.5 4.8 3.5c.7.5 1.7.1 1.9-.7l3-15.7c.2-1-.8-1.9-1.4-1.5z" />
          </svg>
          Message seller
        </a>
      </div>
    );
  };

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
          {isPaid
            ? 'Payment received'
            : isCancelled
              ? 'Order cancelled'
              : proofSubmitted
                ? 'Under review'
                : 'Order placed'}
        </span>
        <h2 className="h-display" style={{ fontSize: 26, marginTop: 6 }}>{headline}</h2>
        <span className="success-id">#{order.order_code}</span>
        <p className="msg" style={{ maxWidth: 320 }}>{subline}</p>
      </div>

      {isPaid && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>
            Your downloads
          </span>
          {loadingDownloads && downloads === null ? (
            <p className="muted" style={{ fontSize: 13 }}>Fetching files…</p>
          ) : downloads === null || downloads.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              No downloadable items in this order.
            </p>
          ) : (
            <>
              {downloads.map((d, i) => (
                <div
                  key={i}
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    padding: '10px 12px',
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                    {d.product_name}
                    {d.file_total > 1 ? ` · ${d.file_index + 1} of ${d.file_total}` : ''}
                  </div>
                  <a href={d.signed_url} target="_blank" rel="noreferrer" className="link-btn">
                    Download (24h link)
                  </a>
                </div>
              ))}
              <button
                type="button"
                className="link-btn"
                style={{ marginTop: 6 }}
                onClick={reloadDownloads}
              >
                Refresh download links
              </button>
            </>
          )}
        </div>
      )}

      {!isPaid && !isCancelled && method === 'stars' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>
            Telegram Stars
          </span>
          <p className="muted" style={{ fontSize: 13 }}>
            Waiting for Telegram to confirm your Stars payment. This page updates automatically.
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

      {!isPaid && !isCancelled && method === 'stripe' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>
            Card payment
          </span>
          <p className="muted" style={{ fontSize: 13 }}>
            Waiting for Stripe to confirm your payment. This page updates automatically.
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

      {!isPaid && !isCancelled && method === 'bank' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>
            Bank transfer
          </span>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            Send {totalLabel} to the account below, then submit proof. Include the order code as the reference.
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
            <button type="button" className="link-btn" onClick={() => copy(state.store.bank_details, 'Details')}>
              Copy details
            </button>
            <button type="button" className="link-btn" onClick={() => copy(order.order_code, 'Order code')}>
              Copy reference
            </button>
          </div>
          <SellerContact />
        </div>
      )}

      {!isPaid && !isCancelled && method === 'crypto' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>
            Crypto payment
          </span>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            Send {totalLabel} worth to one address below, then submit the tx hash.
          </p>
          {[
            { label: 'BTC', value: state.store.crypto_btc },
            { label: 'ETH', value: state.store.crypto_eth },
            { label: 'USDT (TRC20)', value: state.store.crypto_usdt_trc20 },
            { label: 'TON', value: state.store.crypto_ton },
          ]
            .filter((a) => a.value.trim())
            .map((a) => (
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
            ))}
          <SellerContact />
        </div>
      )}

      {!isPaid && !isCancelled && method === 'cod' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>
            Cash on Delivery
          </span>
          <p className="muted" style={{ fontSize: 13 }}>
            Pay {totalLabel} in cash when your order arrives. We'll message you on Telegram to arrange delivery.
          </p>
          <SellerContact />
        </div>
      )}

      {!isPaid && !isCancelled && method === 'manual' && (
        <div className="panel" style={{ marginTop: 20 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>
            Chat with seller
          </span>
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Message the seller on Telegram to arrange payment and delivery. Your order is saved — they'll confirm once payment is sorted.
          </p>
          {telegramDeepLink ? (
            <a
              href={telegramDeepLink}
              target="_blank"
              rel="noreferrer"
              className="btn-primary"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textDecoration: 'none',
                height: 52,
              }}
            >
              Message seller on Telegram
            </a>
          ) : (
            <p className="muted" style={{ fontSize: 12.5 }}>
              The seller hasn't set a Telegram username yet. They'll message you directly.
            </p>
          )}
        </div>
      )}

      {!isPaid && !isCancelled && !proofSubmitted && (method === 'bank' || method === 'crypto') && (
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
            <label>Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={method === 'bank' ? 'Sent from XYZ bank, ref #12345' : 'Sent from wallet 0x…'}
            />
          </div>

          <div className="field">
            <label>Receipt image (optional)</label>
            {!receiptFile ? (
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
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
                <span
                  className="muted"
                  style={{
                    fontSize: 12,
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {receiptFile.name}
                </span>
                <button type="button" className="x-btn" aria-label="Remove file" onClick={clearFile}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </div>
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

      {proofSubmitted && !isPaid && !isCancelled && method !== 'manual' && (
        <div className="panel" style={{ marginTop: 14 }}>
          <span className="section-title" style={{ display: 'block', marginBottom: 10 }}>
            Proof submitted
          </span>
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
