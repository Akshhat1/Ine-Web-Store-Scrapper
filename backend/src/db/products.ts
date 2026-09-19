// backend/src/db/products.ts
// Database operations for tracked_products table.

import { getSupabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import type { StockStatus } from "../scraper/parse.js";

export interface TrackedProduct {
  id: string;
  store_product_id: string;
  name: string;
  url: string;
  image_url: string | null;
  category: string | null;
  brand: string | null;
  sku: string | null;
  description: string | null;
  last_price: number | null;
  last_stock: string | null;
  last_scraped_at: string | null;
  created_at: string;
}

export interface CreateProductInput {
  store_product_id: string;
  name: string;
  url: string;
  image_url?: string | null;
  category?: string | null;
  brand?: string | null;
  sku?: string | null;
  description?: string | null;
}

/** Insert or return existing tracked product (idempotent on store_product_id). */
export async function upsertProduct(
  input: CreateProductInput,
): Promise<TrackedProduct> {
  const db = getSupabase();
  const { data, error } = await db
    .from("tracked_products")
    .upsert(input, { onConflict: "store_product_id", ignoreDuplicates: false })
    .select()
    .single();

  if (error) {
    logger.error("upsertProduct failed", { error: error.message });
    throw new Error(`DB upsertProduct: ${error.message}`);
  }
  return data as TrackedProduct;
}

/** List all tracked products. */
export async function listProducts(): Promise<TrackedProduct[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from("tracked_products")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`DB listProducts: ${error.message}`);
  return (data ?? []) as TrackedProduct[];
}

/** Get one tracked product by our internal UUID. */
export async function getProduct(id: string): Promise<TrackedProduct | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from("tracked_products")
    .select("*")
    .eq("id", id)
    .single();

  if (error?.code === "PGRST116") return null; // not found
  if (error) throw new Error(`DB getProduct: ${error.message}`);
  return data as TrackedProduct;
}

/** Get product by store_product_id (e.g. "852"). */
export async function getProductByStoreId(
  storeProductId: string,
): Promise<TrackedProduct | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from("tracked_products")
    .select("*")
    .eq("store_product_id", storeProductId)
    .maybeSingle();

  if (error) throw new Error(`DB getProductByStoreId: ${error.message}`);
  return (data as TrackedProduct | null) ?? null;
}

/** Update last_price, last_stock, last_scraped_at after a successful scrape. */
export async function updateProductLastScrape(
  id: string,
  price: number,
  stock: StockStatus,
): Promise<void> {
  const db = getSupabase();
  const { error } = await db
    .from("tracked_products")
    .update({
      last_price: price,
      last_stock: stock,
      last_scraped_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(`DB updateProductLastScrape: ${error.message}`);
}

/** Delete a tracked product (cascades to history + logs via FK). */
export async function deleteProduct(id: string): Promise<boolean> {
  const db = getSupabase();
  const { error, count } = await db
    .from("tracked_products")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) throw new Error(`DB deleteProduct: ${error.message}`);
  return (count ?? 0) > 0;
}

/** Summary stats for one product (min/max/avg price, success rate). */
export async function getProductStats(productId: string): Promise<{
  min_price: number | null;
  max_price: number | null;
  avg_price: number | null;
  total_scrapes: number;
  successful_scrapes: number;
  success_rate: number;
}> {
  const db = getSupabase();

  const [histRes, logRes] = await Promise.all([
    db
      .from("price_history")
      .select("price")
      .eq("product_id", productId),
    db
      .from("scrape_logs")
      .select("status")
      .eq("product_id", productId),
  ]);

  const prices = (histRes.data ?? []).map((r: { price: number }) => r.price);
  const logs = logRes.data ?? [];
  const total = logs.length;
  const ok = logs.filter((l: { status: string }) =>
    l.status === "SUCCESS" || l.status === "RETRIED",
  ).length;

  return {
    min_price: prices.length ? Math.min(...prices) : null,
    max_price: prices.length ? Math.max(...prices) : null,
    avg_price: prices.length
      ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100
      : null,
    total_scrapes: total,
    successful_scrapes: ok,
    success_rate: total > 0 ? Math.round((ok / total) * 100) : 0,
  };
}
