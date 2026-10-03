import { formatMoney, type ProductWithCategory } from '../lib/api';
import { PastelThumb } from './PastelThumb';

type Props = {
  product: ProductWithCategory;
  currency: string;
  saved: boolean;
  onOpen: () => void;
  onToggleSaved: () => void;
};

export function ProductCard({ product, currency, saved, onOpen, onToggleSaved }: Props) {
  return (
    <article className="card" onClick={onOpen}>
      <div className="thumb-wrap" style={{ position: 'relative' }}>
        <PastelThumb product={product} className="thumb" />
        <button
          type="button"
          className={`heart${saved ? ' on' : ''}`}
          aria-label="Save"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSaved();
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M12 20.5s-7.5-4.7-9.3-9.2C1.3 7.7 3.6 4.5 6.9 4.5c2 0 3.6 1.1 4.6 2.7.2.4.4.4.6 0 1-1.6 2.6-2.7 4.6-2.7 3.3 0 5.6 3.2 4.2 6.8-1.8 4.5-9.4 9.2-9.4 9.2z" />
          </svg>
        </button>
      </div>
      <div className="card-info">
        <div className="p-cat">{product.category_name}</div>
        <div className="p-name">{product.name}</div>
        <div className="p-price">{formatMoney(product.price, currency)}</div>
      </div>
    </article>
  );
}
