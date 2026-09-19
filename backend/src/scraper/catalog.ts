// backend/src/scraper/catalog.ts
// Store catalog search: fetches and caches all 1000 products, provides in-memory search.
// RECON finding: ?q= and ?search= params are ignored server-side — search is client-side.
// We fetch all products once (10 requests × pageSize=100) and filter in memory.

import { getEnv } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { fetchWithTimeout, HttpError } from "./fetch.js";

export interface StoreProduct {
  id: number;
  slug: string;
  name: string;
  brand: string;
  category: string;
  sku: string;
  description: string;
}

interface CatalogPage {
  page: number;
  pageSize: number;
  pages: number;
  total: number;
  items: StoreProduct[];
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

let _cache: { products: StoreProduct[]; fetchedAt: number } | null = null;

async function getAllProducts(baseUrl: string): Promise<StoreProduct[]> {
  const env = getEnv();
  const now = Date.now();

  if (_cache && now - _cache.fetchedAt < env.CATALOG_CACHE_TTL_MS) {
    return _cache.products;
  }

  logger.info("Fetching full product catalog from store...");
  const PAGE_SIZE = 100;
  const products: StoreProduct[] = [];

  // Fetch page 1 first to find total pages
  const firstPage = await fetchCatalogPage(baseUrl, 1, PAGE_SIZE);
  products.push(...firstPage.items);

  const totalPages = firstPage.pages;
  logger.info(`Catalog: ${firstPage.total} products, ${totalPages} pages`);

  // Fetch remaining pages in sequence (no parallel — be polite)
  for (let p = 2; p <= totalPages; p++) {
    try {
      const page = await fetchCatalogPage(baseUrl, p, PAGE_SIZE);
      products.push(...page.items);
      // Small delay between catalog fetches
      await new Promise((r) => setTimeout(r, 150));
    } catch (err) {
      logger.warn(`Failed to fetch catalog page ${p}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  _cache = { products, fetchedAt: now };
  logger.info(`Catalog cache populated: ${products.length} products`);
  return products;
}

async function fetchCatalogPage(
  baseUrl: string,
  page: number,
  pageSize: number,
): Promise<CatalogPage> {
  const url = `${baseUrl}/api/catalog?page=${page}&pageSize=${pageSize}`;
  const res = await fetchWithTimeout(url, { timeoutMs: 15000 });

  if (!res.ok) {
    throw new HttpError(res.status, `Catalog page ${page} returned ${res.status}`);
  }

  // Try to parse the Retry-After header on 429
  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After");
    const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
    throw new HttpError(429, JSON.stringify({ retryAfterMs }));
  }

  return (await res.json()) as CatalogPage;
}

/** Force-clear the catalog cache (used when structure changes). */
export function clearCatalogCache(): void {
  _cache = null;
}

// ─── Search ───────────────────────────────────────────────────────────────────

export interface SearchResult {
  id: string;           // store integer id as string
  name: string;
  brand: string;
  category: string;
  sku: string;
  description: string;
  url: string;
  image_url: null;      // store has no image API (RECON finding)
}

/**
 * Search the store catalog by partial/full name (case-insensitive).
 * Returns up to 20 matches.
 */
export async function searchStore(query: string): Promise<SearchResult[]> {
  const env = getEnv();

  if (!query || query.trim().length < 2) return [];

  const products = await getAllProducts(env.STORE_BASE_URL);
  const q = query.trim().toLowerCase();

  const matches = products.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.brand.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q),
  );

  return matches.slice(0, 20).map((p) => ({
    id: String(p.id),
    name: p.name,
    brand: p.brand,
    category: p.category,
    sku: p.sku,
    description: p.description,
    url: `${env.STORE_BASE_URL}/product/${p.slug}`,
    image_url: null,
  }));
}

/** Fetch a single product's metadata from /api/product/:id. */
export async function fetchProductMeta(storeProductId: string): Promise<StoreProduct & { slug: string } | null> {
  const env = getEnv();
  const url = `${env.STORE_BASE_URL}/api/product/${storeProductId}`;

  try {
    const res = await fetchWithTimeout(url, { timeoutMs: 10000 });
    if (res.status === 404) return null;
    if (!res.ok) throw new HttpError(res.status, `Product meta ${res.status}`);
    return (await res.json()) as StoreProduct & { slug: string };
  } catch (err) {
    logger.warn("fetchProductMeta failed", {
      storeProductId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
