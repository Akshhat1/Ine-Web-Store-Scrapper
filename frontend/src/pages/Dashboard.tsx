import { useState, useEffect, useCallback } from 'react';
import { api, type TrackedProduct } from '../lib/api';
import { SearchBar } from '../components/SearchBar';
import { ProductCard } from '../components/ProductCard';

// Map productId → last scrape status for dashboard display
type StatusMap = Record<string, 'SUCCESS' | 'RETRIED' | 'FAILED' | null>;
type StructureMap = Record<string, boolean>;

export function Dashboard() {
  const [products, setProducts] = useState<TrackedProduct[]>([]);
  const [statusMap, setStatusMap] = useState<StatusMap>({});
  const [structureMap, setStructureMap] = useState<StructureMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [serverWaking, setServerWaking] = useState(false);
  const [trackError, setTrackError] = useState('');

  const loadProducts = useCallback(async () => {
    try {
      setServerWaking(false);
      const { products: ps } = await api.listProducts();
      setProducts(ps);
      setError('');

      // Fetch last log status for each product (background, non-blocking)
      const statusUpdates: StatusMap = {};
      const structureUpdates: StructureMap = {};
      await Promise.all(ps.map(async p => {
        try {
          const { logs } = await api.getLogs(p.id, 1);
          if (logs.length > 0) {
            statusUpdates[p.id] = logs[0].status;
            structureUpdates[p.id] = logs[0].error_type === 'STRUCTURE_CHANGED';
          }
        } catch { /* ignore */ }
      }));
      setStatusMap(s => ({ ...s, ...statusUpdates }));
      setStructureMap(s => ({ ...s, ...structureUpdates }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load';
      if (msg.includes('unavailable') || msg.includes('reach')) setServerWaking(true);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  const handleTrack = useCallback(async (storeId: string) => {
    setTrackError('');
    try {
      const { product } = await api.trackProduct(storeId);
      setProducts(ps => ps.some(p => p.id === product.id) ? ps : [product, ...ps]);
    } catch (e: unknown) {
      setTrackError(e instanceof Error ? e.message : 'Failed to track product');
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Untrack this product? All history and logs will be deleted.')) return;
    try {
      await api.deleteProduct(id);
      setProducts(ps => ps.filter(p => p.id !== id));
    } catch { /* ignore */ }
  }, []);

  const trackingIds = new Set(products.map(p => p.store_product_id));

  return (
    <div className="space-y-8">
      {/* Hero Search */}
      <div className="text-center space-y-4 pt-4">
        <h1 className="text-3xl font-bold gradient-text">INE Price Tracker</h1>
        <p className="text-gray-500 text-sm max-w-md mx-auto">
          Track prices and stock from the INE demo store. Updated every 2 hours.
        </p>
        <SearchBar onTrack={handleTrack} trackingIds={trackingIds} />
        {trackError && (
          <p className="text-sm text-red-400 animate-fade-in">{trackError}</p>
        )}
      </div>

      {/* Server waking notice */}
      {serverWaking && (
        <div className="glass-card p-4 border border-brand-500/20 text-center text-sm text-brand-400 animate-pulse-slow">
          🌅 Waking up the server… this may take 30–60 seconds on first visit.
        </div>
      )}

      {/* Product grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass-card p-5 h-44 shimmer rounded-2xl" />
          ))}
        </div>
      ) : error && !serverWaking ? (
        <div className="glass-card p-8 text-center">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={loadProducts} className="btn-primary mt-4 mx-auto">Retry</button>
        </div>
      ) : products.length === 0 ? (
        <div className="glass-card p-12 text-center space-y-3">
          <div className="text-4xl">📦</div>
          <p className="text-gray-400 font-medium">No products tracked yet</p>
          <p className="text-gray-600 text-sm">Search above to find and track products</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-500">
              {products.length} product{products.length !== 1 ? 's' : ''} tracked
            </h2>
            <button onClick={loadProducts} className="btn-ghost text-xs">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map(p => (
              <ProductCard
                key={p.id}
                product={p}
                lastStatus={statusMap[p.id]}
                hasStructureChanged={structureMap[p.id]}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
