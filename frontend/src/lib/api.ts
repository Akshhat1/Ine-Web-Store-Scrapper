// frontend/src/lib/api.ts
// Typed API client with sleeping-server retry logic.

const API_URL = import.meta.env.VITE_API_URL || '';

// Retry if backend returns 502/503/504 (Render sleeping)
async function apiFetch(path: string, options?: RequestInit, retries = 3): Promise<Response> {
  const url = `${API_URL}${path}`;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options?.headers },
      });
      // Don't retry on client errors
      if (res.status < 500) return res;
      if (i < retries - 1) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    } catch {
      if (i < retries - 1) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
      else throw new Error('Cannot reach server');
    }
  }
  throw new Error('Server unavailable after retries');
}

async function get<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((body as {error?: string}).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    const b = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((b as {error?: string}).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await apiFetch(path, { method: 'DELETE' });
  if (!res.ok) {
    const b = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((b as {error?: string}).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SearchResult {
  id: string; name: string; brand: string; category: string;
  sku: string; description: string; url: string; image_url: null;
}

export interface TrackedProduct {
  id: string; store_product_id: string; name: string; url: string;
  image_url: null; category: string | null; brand: string | null;
  sku: string | null; description: string | null;
  last_price: number | null; last_stock: string | null;
  last_scraped_at: string | null; created_at: string;
}

export interface ProductStats {
  min_price: number | null; max_price: number | null; avg_price: number | null;
  total_scrapes: number; successful_scrapes: number; success_rate: number;
}

export interface PriceHistoryRow {
  id: number; product_id: string; run_id: string | null;
  price: number; stock: string; scraped_at: string;
}

export interface ScrapeLogRow {
  id: number; product_id: string; run_id: string | null;
  attempt: number; status: 'SUCCESS' | 'RETRIED' | 'FAILED';
  latency_ms: number | null; http_status: number | null;
  error_type: string | null; error_message: string | null; created_at: string;
}

export interface ScrapeRun {
  id: string; trigger: string; started_at: string; finished_at: string | null;
  products_total: number; products_ok: number; products_failed: number;
}

export interface Alert {
  id: number; product_id: string; type: string;
  old_value: string | null; new_value: string | null;
  seen: boolean; created_at: string;
  tracked_products?: { name: string };
}

// ── API methods ───────────────────────────────────────────────────────────────

export const api = {
  health: () => get<{ status: string }>('/health'),
  search: (q: string) => get<{ results: SearchResult[] }>(`/api/store/search?q=${encodeURIComponent(q)}`),
  listProducts: () => get<{ products: TrackedProduct[] }>('/api/products'),
  trackProduct: (store_product_id: string) =>
    post<{ product: TrackedProduct }>('/api/products', { store_product_id }),
  getProduct: (id: string) => get<{ product: TrackedProduct; stats: ProductStats }>(`/api/products/${id}`),
  getHistory: (id: string, limit = 100) =>
    get<{ history: PriceHistoryRow[] }>(`/api/products/${id}/history?limit=${limit}`),
  getLogs: (id: string, limit = 50) =>
    get<{ logs: ScrapeLogRow[] }>(`/api/products/${id}/logs?limit=${limit}`),
  deleteProduct: (id: string) => del<{ success: boolean }>(`/api/products/${id}`),
  getRuns: () => get<{ runs: ScrapeRun[] }>('/api/runs'),
  getAlerts: () => get<{ alerts: Alert[] }>('/api/alerts'),
  markAlertsSeen: (ids: number[]) => post<{ success: boolean }>('/api/alerts/mark-seen', { ids }),
};
