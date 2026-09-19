import { Link } from 'react-router-dom';
import type { TrackedProduct } from '../lib/api';
import { formatPrice, formatRelative, stockBadgeClass, stockLabel, statusBadgeClass } from '../lib/utils';

interface Props {
  product: TrackedProduct;
  previousPrice?: number | null;
  lastStatus?: 'SUCCESS' | 'RETRIED' | 'FAILED' | null;
  hasStructureChanged?: boolean;
  onDelete: (id: string) => void;
}

export function ProductCard({ product, previousPrice, lastStatus, hasStructureChanged, onDelete }: Props) {
  const priceChanged = product.last_price !== null && previousPrice !== null && previousPrice !== undefined;
  const priceDelta = priceChanged ? product.last_price! - previousPrice! : null;
  const pricePct = (priceDelta !== null && previousPrice) ? (priceDelta / previousPrice) * 100 : null;

  return (
    <div className="glass-card-hover p-5 flex flex-col gap-4 animate-slide-up group">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <Link to={`/product/${product.id}`}
            className="text-base font-semibold text-gray-100 hover:text-brand-400 transition-colors line-clamp-2 leading-snug">
            {product.name}
          </Link>
          <p className="text-xs text-gray-500 mt-1">
            {product.brand && <span className="text-brand-400">{product.brand}</span>}
            {product.brand && product.category && ' · '}
            {product.category}
          </p>
        </div>
        <button
          onClick={() => onDelete(product.id)}
          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-400/10 transition-all duration-200 shrink-0"
          title="Untrack product"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* Price + Stock */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold gradient-text">
              {formatPrice(product.last_price)}
            </span>
            {priceDelta !== null && pricePct !== null && (
              <span className={`text-xs font-medium ${priceDelta > 0 ? 'text-red-400' : priceDelta < 0 ? 'text-emerald-400' : 'text-gray-500'}`}>
                {priceDelta > 0 ? '▲' : priceDelta < 0 ? '▼' : ''}
                {Math.abs(pricePct).toFixed(1)}%
              </span>
            )}
          </div>
          {product.last_stock && (
            <span className={`mt-1.5 inline-block ${stockBadgeClass(product.last_stock)}`}>
              {stockLabel(product.last_stock)}
            </span>
          )}
        </div>

        <div className="text-right">
          {lastStatus && (
            <span className={`${statusBadgeClass(lastStatus)} mb-1`}>
              {lastStatus}
            </span>
          )}
          <p className="text-xs text-gray-600">
            {formatRelative(product.last_scraped_at)}
          </p>
        </div>
      </div>

      {/* Structure changed alert (Bonus 1) */}
      {hasStructureChanged && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
          <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          STRUCTURE_CHANGED — store layout may have changed
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-800/40">
        <Link to={`/product/${product.id}`}
          className="text-xs text-brand-400 hover:text-brand-300 transition-colors font-medium">
          View history →
        </Link>
        <span className="font-mono text-xs text-gray-700">#{product.store_product_id}</span>
      </div>
    </div>
  );
}
