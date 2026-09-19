import { useState, useCallback, useEffect, useRef } from 'react';
import { api, type SearchResult } from '../lib/api';

interface Props {
  onTrack: (id: string) => Promise<void>;
  trackingIds: Set<string>;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function SearchBar({ onTrack, trackingIds }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const debouncedQuery = useDebounce(query, 350);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debouncedQuery.length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    setError('');
    api.search(debouncedQuery)
      .then(r => { setResults(r.results); setOpen(true); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [debouncedQuery]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleTrack = useCallback(async (result: SearchResult) => {
    setTrackingId(result.id);
    setOpen(false);
    setQuery('');
    setResults([]);
    try { await onTrack(result.id); }
    finally { setTrackingId(null); }
  }, [onTrack]);

  return (
    <div ref={containerRef} className="relative w-full max-w-2xl mx-auto">
      <div className="relative">
        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
          {loading
            ? <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            : <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
          }
        </div>
        <input
          id="search-input"
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search products by name, brand or category…"
          className="w-full pl-11 pr-4 py-3.5 bg-gray-900/80 border border-gray-700/50 rounded-2xl text-gray-100 placeholder-gray-500 focus:outline-none focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/20 transition-all duration-200 text-sm"
        />
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {open && results.length > 0 && (
        <div className="absolute top-full mt-2 w-full z-50 glass-card shadow-2xl shadow-black/50 overflow-hidden animate-slide-up">
          <div className="p-2 max-h-96 overflow-y-auto">
            {results.map(r => (
              <div key={r.id}
                className="flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-gray-800/60 transition-colors duration-150 cursor-pointer group"
                onClick={() => !trackingIds.has(r.id) && handleTrack(r)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-100 truncate">{r.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    <span className="text-brand-400">{r.brand}</span>
                    {' · '}{r.category}{' · '}<span className="font-mono">{r.sku}</span>
                  </p>
                </div>
                {trackingIds.has(r.id) ? (
                  <span className="badge-success shrink-0">Tracked</span>
                ) : trackingId === r.id ? (
                  <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin shrink-0" />
                ) : (
                  <button className="btn-primary shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-xs py-1.5">
                    Track
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="px-4 py-2 border-t border-gray-800/50 text-xs text-gray-600">
            {results.length} result{results.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {open && query.length >= 2 && results.length === 0 && !loading && (
        <div className="absolute top-full mt-2 w-full z-50 glass-card p-4 text-center text-sm text-gray-500 animate-fade-in">
          No products found for "{query}"
        </div>
      )}
    </div>
  );
}
