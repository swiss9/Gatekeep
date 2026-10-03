import { useEffect, useState } from 'react';
import type { PastelColor, Product } from '../lib/api';

export const PASTEL_HEX: Record<PastelColor, string> = {
  blue: '#E0F2FE',
  pink: '#FCE7F3',
  yellow: '#FEF3C7',
  mint: '#D1FAE5',
};

function toPastel(color: string | null | undefined): PastelColor {
  if (color === 'blue' || color === 'pink' || color === 'yellow' || color === 'mint') return color;
  return 'blue';
}

type Props = {
  product: Pick<Product, 'name' | 'image_url' | 'pastel_color'>;
  initialSize?: number;
  className?: string;
};

export function PastelThumb({ product, initialSize, className }: Props) {
  const pastel = toPastel(product.pastel_color);
  const style = { background: PASTEL_HEX[pastel] };
  const initial = product.name.charAt(0).toUpperCase() || '?';
  const [imgFailed, setImgFailed] = useState(false);

  // If a different product reuses this component instance, reset the
  // failure flag so the new URL gets a chance to load.
  useEffect(() => {
    setImgFailed(false);
  }, [product.image_url]);

  const showImg = !!product.image_url && !imgFailed;

  return (
    <div className={className ?? 'thumb'} style={style}>
      {showImg ? (
        <img
          src={product.image_url as string}
          alt={product.name}
          loading="lazy"
          onError={() => {
            // Surface in DevTools so a broken URL isn't silent.
            console.warn('[PastelThumb] image failed to load:', product.image_url);
            setImgFailed(true);
          }}
        />
      ) : (
        <span
          className="initial"
          style={initialSize ? { fontSize: `${initialSize}px` } : undefined}
        >
          {initial}
        </span>
      )}
    </div>
  );
}
