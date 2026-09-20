// backend/src/scraper/orchestrator.ts
// The batch scraper: scrapes all tracked products sequentially.
//
// RELIABILITY DESIGN:
//   - One product failing never stops the batch (try/catch per product)
//   - Log semantics enforced exactly:
//       • Failed attempts that are later retried → logged with error details
//       • Final attempt → SUCCESS (first try worked), RETRIED (succeeded after ≥1 fail),
//         or FAILED (all attempts failed)
//       • Only SUCCESS/RETRIED write to price_history and update last_*
//       • On FAILED: no price_history write, no last_price overwrite
//   - Global per-run time budget: stop processing remaining products if exceeded
//   - Price-jump re-verification: if new price differs >50% from last, fetch once more

import { getEnv } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { listProducts, updateProductLastScrape, type TrackedProduct } from "../db/products.js";
import {
  insertPriceHistory,
  insertScrapeLog,
  createScrapeRun,
  finishScrapeRun,
  hasActiveRun,
  insertAlert,
} from "../db/history.js";
import { scrapeProductPrice, type ScrapeOutcome } from "./browser.js";
import { isPriceJump } from "./parse.js";

// Small delay between products to be a polite scraper
const BETWEEN_PRODUCT_DELAY_MS = 2000;

// How long an "active" run must be before we consider it stale/overlapping
const OVERLAP_GUARD_MS = 10 * 60 * 1000; // 10 minutes

// ─── Per-product scrape (with retry + logging) ────────────────────────────────

interface ProductScrapeResult {
  ok: boolean;
  priceJumpFlagged?: boolean;
}

async function scrapeOneProduct(
  product: TrackedProduct,
  runId: string,
): Promise<ProductScrapeResult> {
  const env = getEnv();
  const maxAttempts = env.MAX_RETRIES + 1;

  let lastOutcome: ScrapeOutcome | null = null;
  let totalAttempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    totalAttempts = attempt;
    const attemptStart = Date.now();

    logger.info(`Scraping product`, {
      productId: product.id,
      storeId: product.store_product_id,
      name: product.name,
      attempt,
    });

    const outcome = await scrapeProductPrice(
      product.store_product_id,
      // IMPORTANT: The INE demo store SPA uses /product/:id (numeric ID), NOT slugs.
      // store_product_id is the numeric ID (e.g. "301"), so use it directly.
      product.store_product_id,
      product.last_price,
    );

    const latencyMs = Date.now() - attemptStart;
    lastOutcome = outcome;

    if (outcome.ok) {
      // Determine final log status
      const status = attempt === 1 ? "SUCCESS" : "RETRIED";

      // Check for price jump — if flagged, re-verify with one more scrape
      let priceJumpFlagged = isPriceJump(
        outcome.data.price,
        product.last_price,
        env.PRICE_JUMP_THRESHOLD,
      );

      let finalPrice = outcome.data.price;
      let finalStock = outcome.data.stock;

      if (priceJumpFlagged) {
        logger.warn("Price jump flagged — re-verifying", {
          productId: product.id,
          lastPrice: product.last_price,
          newPrice: outcome.data.price,
        });
        // One extra fetch to confirm
        const verify = await scrapeProductPrice(
          product.store_product_id,
          product.store_product_id, // Numeric ID for the store SPA URL
          product.last_price,
        );
        if (verify.ok) {
          finalPrice = verify.data.price;
          finalStock = verify.data.stock;
          // If verification agrees with original (within 5%), it's a real change
          const priceDiff = Math.abs(finalPrice - outcome.data.price) / outcome.data.price;
          priceJumpFlagged = priceDiff < 0.05; // true = confirmed real change
        }
      }

      // Write the final log row
      await insertScrapeLog({
        product_id: product.id,
        run_id: runId,
        attempt,
        status,
        latency_ms: latencyMs,
        error_message: priceJumpFlagged
          ? `Price jump confirmed: ${product.last_price} → ${finalPrice} (>${env.PRICE_JUMP_THRESHOLD * 100}% change)`
          : null,
      }).catch((e) => logger.error("insertScrapeLog failed", { error: e.message }));

      // Write price history
      await insertPriceHistory({
        product_id: product.id,
        run_id: runId,
        price: finalPrice,
        stock: finalStock,
      }).catch((e) => logger.error("insertPriceHistory failed", { error: e.message }));

      // Update product's last_* fields
      await updateProductLastScrape(product.id, finalPrice, finalStock).catch(
        (e) => logger.error("updateProductLastScrape failed", { error: e.message }),
      );

      // Alerts: price drop
      if (product.last_price !== null && finalPrice < product.last_price) {
        await insertAlert({
          product_id: product.id,
          type: "price_drop",
          old_value: String(product.last_price),
          new_value: String(finalPrice),
        }).catch(() => {});
      }

      // Alerts: back in stock
      if (product.last_stock === "out_of_stock" && finalStock === "in_stock") {
        await insertAlert({
          product_id: product.id,
          type: "back_in_stock",
          old_value: "out_of_stock",
          new_value: "in_stock",
        }).catch(() => {});
      }

      logger.info(`Scrape SUCCESS`, {
        productId: product.id,
        name: product.name,
        price: finalPrice,
        stock: finalStock,
        status,
        attempts: attempt,
        priceJumpFlagged,
      });

      return { ok: true, priceJumpFlagged };
    } else {
      // This attempt failed — log it
      const isLastAttempt = attempt === maxAttempts;
      const logStatus = isLastAttempt ? "FAILED" : "RETRIED";

      await insertScrapeLog({
        product_id: product.id,
        run_id: runId,
        attempt,
        status: logStatus,
        latency_ms: latencyMs,
        http_status: outcome.httpStatus ?? null,
        error_type: outcome.errorType,
        error_message: outcome.errorMessage,
      }).catch((e) => logger.error("insertScrapeLog failed", { error: e.message }));

      logger.warn(`Scrape attempt ${attempt} failed`, {
        productId: product.id,
        name: product.name,
        errorType: outcome.errorType,
        errorMessage: outcome.errorMessage,
        isLastAttempt,
      });

      // Structure-changed or 404: do not retry
      if (
        outcome.errorType === "STRUCTURE_CHANGED" ||
        (outcome.httpStatus === 404)
      ) {
        if (outcome.errorType === "STRUCTURE_CHANGED") {
          await insertAlert({
            product_id: product.id,
            type: "structure_changed",
            new_value: outcome.errorMessage,
          }).catch(() => {});
        }
        break;
      }

      if (isLastAttempt) break;

      // Backoff before next attempt
      const backoffMs = Math.min(15000, 1000 * 2 ** (attempt - 1));
      const jitteredMs = backoffMs * (0.8 + Math.random() * 0.4);
      logger.info(`Backoff before retry`, { ms: Math.round(jitteredMs), nextAttempt: attempt + 1 });
      await new Promise((r) => setTimeout(r, jitteredMs));
    }
  }

  // All attempts exhausted — FAILED (log already written above)
  return { ok: false };
}

// ─── Batch run ────────────────────────────────────────────────────────────────

interface RunResult {
  runId: string;
  total: number;
  ok: number;
  failed: number;
  skipped: boolean;
  reason?: string;
}

/**
 * Run a full batch scrape of all tracked products.
 * Called in the background by POST /api/cron/scrape-all.
 */
export async function runBatchScrape(trigger: "cron" | "manual" | "headed"): Promise<RunResult> {
  const env = getEnv();

  // Overlap guard: skip if a run started in the last OVERLAP_GUARD_MS is still unfinished
  const hasActive = await hasActiveRun(OVERLAP_GUARD_MS);
  if (hasActive) {
    logger.warn("Batch scrape skipped — another run is still active", { trigger });
    return { runId: "", total: 0, ok: 0, failed: 0, skipped: true, reason: "overlap" };
  }

  const runId = await createScrapeRun(trigger);
  const products = await listProducts();
  const total = products.length;

  logger.info(`Batch scrape started`, { runId, trigger, total });

  let ok = 0;
  let failed = 0;
  const runStart = Date.now();

  for (const product of products) {
    // Global time budget check
    if (Date.now() - runStart > env.RUN_TIME_BUDGET_MS) {
      logger.warn("Run time budget exceeded — stopping batch early", {
        runId,
        processed: ok + failed,
        remaining: total - ok - failed,
      });
      break;
    }

    try {
      const result = await scrapeOneProduct(product, runId);
      if (result.ok) {
        ok++;
      } else {
        failed++;
      }
    } catch (err: unknown) {
      // One product's failure must NEVER crash the batch
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Unexpected error scraping product", {
        productId: product.id,
        name: product.name,
        error: msg,
      });
      // Write a FAILED log row so there's always a record
      await insertScrapeLog({
        product_id: product.id,
        run_id: runId,
        attempt: 1,
        status: "FAILED",
        latency_ms: null,
        error_type: "UNKNOWN",
        error_message: msg,
      }).catch(() => {});
    }

    // Small courteous delay between products
    await new Promise((r) => setTimeout(r, BETWEEN_PRODUCT_DELAY_MS));
  }

  await finishScrapeRun(runId, { products_total: total, products_ok: ok, products_failed: failed });

  logger.info(`Batch scrape finished`, { runId, total, ok, failed });
  return { runId, total, ok, failed, skipped: false };
}

// ─── Single-product scrape (for manual endpoint) ──────────────────────────────

export async function scrapeSingleProduct(
  product: TrackedProduct,
  trigger: "manual" | "headed",
): Promise<{ ok: boolean; runId: string }> {
  const runId = await createScrapeRun(trigger);
  let ok = false;

  try {
    const result = await scrapeOneProduct(product, runId);
    ok = result.ok;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await insertScrapeLog({
      product_id: product.id,
      run_id: runId,
      attempt: 1,
      status: "FAILED",
      latency_ms: null,
      error_type: "UNKNOWN",
      error_message: msg,
    }).catch(() => {});
  }

  await finishScrapeRun(runId, {
    products_total: 1,
    products_ok: ok ? 1 : 0,
    products_failed: ok ? 0 : 1,
  });

  return { ok, runId };
}
