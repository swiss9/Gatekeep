import { useRouter } from '../App';

type Props = { orderCode: string };

export function OrderConfirmation({ orderCode }: Props) {
  const { navigate } = useRouter();

  return (
    <section className="screen active">
      <div className="success-wrap">
        <div className="success-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#111111" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m4.5 12.5 5 5L19.5 7" />
          </svg>
        </div>
        <span className="eyebrow muted">Order received</span>
        <h2 className="h-display" style={{ fontSize: 26, marginTop: 6 }}>
          Order placed
        </h2>
        <span className="success-id">#{orderCode}</span>
        <p className="msg">
          We'll message you on Telegram once your order is confirmed. Digital
          goods are delivered the moment the admin marks your order as Delivered.
        </p>
        <button type="button" className="btn-primary" onClick={() => navigate({ name: 'shop' })}>
          Continue shopping
        </button>
      </div>
    </section>
  );
}
