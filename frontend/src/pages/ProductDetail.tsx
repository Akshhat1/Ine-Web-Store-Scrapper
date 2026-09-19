import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, type TrackedProduct, type ProductStats, type PriceHistoryRow, type ScrapeLogRow } from '../lib/api';
import { PriceChart } from '../components/PriceChart';
import { ScrapeLogTable } from '../components/ScrapeLogTable';
import { formatPrice, formatRelative, stockBadgeClass, stockLabel, nextScrapeTime } from '../lib/utils';

export function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const [product, setProduct] = useState<TrackedProduct | null>(null);
  const [stats, setStats] = useState<ProductStats | null>(null);
  const [history, setHistory] = useState<PriceHistoryRow[]>([]);
  const [logs, setLogs] = useState<ScrapeLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'chart' | 'logs'>('chart');
  const [hasStructureChanged, setHasStructureChanged] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.getProduct(id),
      api.getHistory(id, 200),
      api.getLogs(id, 50),
    ]).then(([pd, hd, ld]) => {
      setProduct(pd.product);
      setStats(pd.stats);
      setHistory(hd.history);
      setLogs(ld.logs);
      // Check if any recent log shows STRUCTURE_CHANGED
      setHasStructureChanged(ld.logs.some(l => l.error_type === 'STRUCTURE_CHANGED'));
    }).catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="glass-card h-32 shimmer rounded-2xl" />
      ))}
    </div>
  );

  if (error || !product) return (
    <div className="glass-card p-8 text-center">
      <p className="text-red-400">{error || 'Product not found'}</p>
      <Link to="/" className="btn-primary mt-4 inline-flex">← Back</Link>
    </div>
  );

  const nextScrape = nextScrapeTime(product.last_scraped_at);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <Link to="/" className="btn-ghost text-xs inline-flex">
        ← Back to dashboard
      </Link>

      {/* Structure changed alert */}
      {hasStructureChanged && (
        <div className="glass-card p-4 border border-amber-500/30 bg-amber-500/5 flex items-start gap-3">
          <span className="text-amber-400 text-xl shrink-0">⚠️</span>
          <div>
            <p className="text-amber-400 font-semibold text-sm">STRUCTURE_CHANGED Detected</p>
            <p className="text-gray-500 text-xs mt-0.5">
              The store's page structure appears to have changed. Recent scrapes may have failed.
              Check the scrape log for details.
            </p>
          </div>
        </div>
      )}

      {/* Product header */}
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-gray-100">{product.name}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {product.brand && <span className="text-brand-400 font-medium">{product.brand}</span>}
              {product.brand && product.category && ' · '}
              {product.category}
              {product.sku && <span className="font-mono text-gray-600"> · {product.sku}</span>}
            </p>
          </div>
          <a href={product.url} target="_blank" rel="noopener noreferrer"
            className="btn-ghost text-xs shrink-0">
            View on store ↗
          </a>
        </div>

        {/* Price + stock */}
        <div className="flex items-end gap-6 flex-wrap">
          <div>
            <p className="text-xs text-gray-600 mb-1">Current Price</p>
            <p className="text-4xl font-bold gradient-text">{formatPrice(product.last_price)}</p>
          </div>
          {product.last_stock && (
            <span className={`mb-1 ${stockBadgeClass(product.last_stock)} text-sm`}>
              {stockLabel(product.last_stock)}
            </span>
          )}
          <div className="ml-auto text-right">
            <p className="text-xs text-gray-600">Last scraped</p>
            <p className="text-sm text-gray-400">{formatRelative(product.last_scraped_at)}</p>
            <p className="text-xs text-gray-600 mt-1">Next scrape</p>
            <p className="text-sm text-brand-400">{nextScrape}</p>
          </div>
        </div>

        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-gray-800/40">
            {[
              { label: 'Min Price', value: formatPrice(stats.min_price), color: 'text-emerald-400' },
              { label: 'Max Price', value: formatPrice(stats.max_price), color: 'text-red-400' },
              { label: 'Avg Price', value: formatPrice(stats.avg_price), color: 'text-brand-400' },
              { label: 'Success Rate', value: `${stats.success_rate}%`, color: stats.success_rate >= 80 ? 'text-emerald-400' : 'text-amber-400' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <p className="text-xs text-gray-600">{s.label}</p>
                <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 glass-card rounded-xl w-fit">
        {(['chart', 'logs'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 capitalize ${
              activeTab === tab
                ? 'bg-brand-600 text-white shadow'
                : 'text-gray-500 hover:text-gray-300'
            }`}>
            {tab === 'chart' ? '📈 Chart' : '📋 Scrape Logs'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'chart' ? (
        <PriceChart history={history} />
      ) : (
        <ScrapeLogTable logs={logs} />
      )}
    </div>
  );
}
