// backend/src/db/history.ts
// Database operations for price_history and scrape_logs tables.

import { getSupabase } from "../lib/supabase.js";

export interface PriceHistoryRow {
  id: number;
  product_id: string;
  run_id: string | null;
  price: number;
  stock: string;
  scraped_at: string;
}

export interface ScrapeLogRow {
  id: number;
  product_id: string;
  run_id: string | null;
  attempt: number;
  status: "SUCCESS" | "RETRIED" | "FAILED";
  latency_ms: number | null;
  http_status: number | null;
  error_type: string | null;
  error_message: string | null;
  created_at: string;
}

// ─── price_history ────────────────────────────────────────────────────────────

/** Insert one price history row (called only on SUCCESS or RETRIED). */
export async function insertPriceHistory(row: {
  product_id: string;
  run_id: string | null;
  price: number;
  stock: string;
}): Promise<void> {
  const db = getSupabase();
  const { error } = await db.from("price_history").insert({
    ...row,
    scraped_at: new Date().toISOString(),
  });
  if (error) throw new Error(`DB insertPriceHistory: ${error.message}`);
}

/** Get price/stock history for a product (most recent first). */
export async function getPriceHistory(
  productId: string,
  limit = 100,
): Promise<PriceHistoryRow[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from("price_history")
    .select("*")
    .eq("product_id", productId)
    .order("scraped_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`DB getPriceHistory: ${error.message}`);
  return (data ?? []) as PriceHistoryRow[];
}

// ─── scrape_logs ──────────────────────────────────────────────────────────────

/** Insert one scrape log row. Called for EVERY attempt. */
export async function insertScrapeLog(row: {
  product_id: string;
  run_id: string | null;
  attempt: number;
  status: "SUCCESS" | "RETRIED" | "FAILED";
  latency_ms: number | null;
  http_status?: number | null;
  error_type?: string | null;
  error_message?: string | null;
}): Promise<void> {
  const db = getSupabase();
  const { error } = await db.from("scrape_logs").insert({
    product_id: row.product_id,
    run_id: row.run_id,
    attempt: row.attempt,
    status: row.status,
    latency_ms: row.latency_ms ?? null,
    http_status: row.http_status ?? null,
    error_type: row.error_type ?? null,
    error_message: row.error_message ?? null,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(`DB insertScrapeLog: ${error.message}`);
}

/** Get scrape logs for a product (most recent first). */
export async function getScrapeLogs(
  productId: string,
  limit = 50,
): Promise<ScrapeLogRow[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from("scrape_logs")
    .select("*")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`DB getScrapeLogs: ${error.message}`);
  return (data ?? []) as ScrapeLogRow[];
}

// ─── scrape_runs ──────────────────────────────────────────────────────────────

export interface ScrapeRunRow {
  id: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  products_total: number;
  products_ok: number;
  products_failed: number;
}

export async function createScrapeRun(trigger: "cron" | "manual" | "headed"): Promise<string> {
  const db = getSupabase();
  const { data, error } = await db
    .from("scrape_runs")
    .insert({ trigger, started_at: new Date().toISOString() })
    .select("id")
    .single();

  if (error) throw new Error(`DB createScrapeRun: ${error.message}`);
  return (data as { id: string }).id;
}

export async function finishScrapeRun(
  runId: string,
  stats: { products_total: number; products_ok: number; products_failed: number },
): Promise<void> {
  const db = getSupabase();
  const { error } = await db
    .from("scrape_runs")
    .update({ ...stats, finished_at: new Date().toISOString() })
    .eq("id", runId);

  if (error) throw new Error(`DB finishScrapeRun: ${error.message}`);
}

/** Check if a run is currently in progress (started < N minutes ago, no finished_at). */
export async function hasActiveRun(withinMs: number): Promise<boolean> {
  const db = getSupabase();
  const since = new Date(Date.now() - withinMs).toISOString();
  const { data, error } = await db
    .from("scrape_runs")
    .select("id")
    .is("finished_at", null)
    .gte("started_at", since)
    .limit(1);

  if (error) return false;
  return (data ?? []).length > 0;
}

export async function getRecentRuns(limit = 20): Promise<ScrapeRunRow[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from("scrape_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`DB getRecentRuns: ${error.message}`);
  return (data ?? []) as ScrapeRunRow[];
}

// ─── alerts ───────────────────────────────────────────────────────────────────

export async function insertAlert(row: {
  product_id: string;
  type: "price_drop" | "back_in_stock" | "structure_changed";
  old_value?: string | null;
  new_value?: string | null;
}): Promise<void> {
  const db = getSupabase();
  await db.from("alerts").insert({ ...row, seen: false });
}

export async function getUnseenAlerts(): Promise<unknown[]> {
  const db = getSupabase();
  const { data } = await db
    .from("alerts")
    .select("*, tracked_products(name)")
    .eq("seen", false)
    .order("created_at", { ascending: false })
    .limit(50);
  return data ?? [];
}

export async function markAlertsSeen(ids: number[]): Promise<void> {
  const db = getSupabase();
  await db.from("alerts").update({ seen: true }).in("id", ids);
}
