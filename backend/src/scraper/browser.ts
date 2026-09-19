// backend/src/scraper/browser.ts
// Playwright-based price/stock scraper.
//
// DESIGN DECISION (from RECON):
//   The store uses a 5-layer bot-detection system (canvas+WebGL fingerprints,
//   frame timing, WASM proof-of-work, mouse hover tracking). Price/stock cannot
//   be obtained via plain HTTP. Playwright is the ONLY viable path.
//
// MEMORY SAFETY:
//   - Browser is loaded lazily (dynamic import) gated by ENABLE_BROWSER=true
//   - Only ONE browser instance is created per process
//   - Products are scraped sequentially — never multiple pages in parallel
//   - Browser is reused across scrapes (launch once, reuse context)

import { getEnv } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { parsePrice, normalizeStock, pricesAgree, isPriceJump, type StockStatus } from "./parse.js";
import { HttpError, TimeoutError } from "./fetch.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScrapeResult {
  price: number;
  stock: StockStatus;
  /** raw text read from DOM for debugging */
  rawPrice: string;
  rawStock: string;
}

export type ScrapeOutcome =
  | { ok: true; data: ScrapeResult }
  | { ok: false; errorType: string; errorMessage: string; httpStatus?: number };

// ─── Browser singleton ───────────────────────────────────────────────────────

let _browser: import("playwright").Browser | null = null;

async function getBrowser(headless = true, slowMo = 0): Promise<import("playwright").Browser> {
  if (_browser && _browser.isConnected()) return _browser;

  if (!getEnv().ENABLE_BROWSER) {
    throw new Error("ENABLE_BROWSER is false — cannot use Playwright");
  }

  // Lazy import: Playwright is only loaded when needed
  const { chromium } = await import("playwright");
  logger.info("Launching Playwright Chromium browser", { headless, slowMo });

  _browser = await chromium.launch({ headless, slowMo });
  return _browser;
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

// ─── Layout fetch ─────────────────────────────────────────────────────────────

interface LayoutClasses {
  priceValue: string;
  stock: string;
  priceWrap: string;
}

let _layoutCache: { classes: LayoutClasses; fetchedAt: number } | null = null;
const LAYOUT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch /api/layout to get current (potentially rotated) CSS class names.
 * Caches for 5 minutes. This is the STRUCTURE_CHANGED canary.
 */
export async function fetchLayout(baseUrl: string): Promise<LayoutClasses | null> {
  const now = Date.now();
  if (_layoutCache && now - _layoutCache.fetchedAt < LAYOUT_CACHE_TTL) {
    return _layoutCache.classes;
  }

  try {
    const res = await fetch(`${baseUrl}/api/layout`);
    if (!res.ok) return null;
    const data = (await res.json()) as { classes?: { priceValue?: string; stock?: string; priceWrap?: string } };
    if (!data.classes?.priceValue) return null;

    const classes: LayoutClasses = {
      priceValue: data.classes.priceValue,
      stock: data.classes.stock ?? "",
      priceWrap: data.classes.priceWrap ?? "",
    };
    _layoutCache = { classes, fetchedAt: now };
    return classes;
  } catch {
    return null;
  }
}

export function clearLayoutCache(): void {
  _layoutCache = null;
}

// ─── Hover simulation ────────────────────────────────────────────────────────

/**
 * Simulate realistic human hover over the price area.
 * The store requires minMoves=8 over minDwellMs=600ms.
 * We use 12 moves over 800ms with small random offsets for realism.
 */
async function simulateHover(
  page: import("playwright").Page,
  priceSelector: string,
): Promise<boolean> {
  try {
    const priceEl = page.locator(priceSelector).first();
    await priceEl.waitFor({ state: "attached", timeout: 15000 });
    const box = await priceEl.boundingBox();
    if (!box) return false;

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Move mouse to the element first
    await page.mouse.move(cx - 50, cy - 30);
    await page.waitForTimeout(100);

    // Make 12 moves with small jitter across the element over ~900ms
    for (let i = 0; i < 12; i++) {
      const dx = (Math.random() - 0.5) * box.width * 0.8;
      const dy = (Math.random() - 0.5) * box.height * 0.8;
      await page.mouse.move(cx + dx, cy + dy, { steps: 3 });
      await page.waitForTimeout(60 + Math.random() * 40);
    }

    return true;
  } catch {
    return false;
  }
}

// ─── Wait for price to load ───────────────────────────────────────────────────

/**
 * Wait for the price widget to move from idle/loading phase to success.
 * We watch for the price-block element to not have 'price-idle' or 'price-loading' class.
 * Returns the element text when ready, or null on timeout.
 */
async function waitForPriceReady(
  page: import("playwright").Page,
  priceWrapSelector: string,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const el = page.locator(priceWrapSelector).first();
      const className = await el.getAttribute("class", { timeout: 2000 }).catch(() => null);

      if (className?.includes("price-success")) {
        // Price block reached success state — read the price text
        return await el.textContent({ timeout: 2000 }).catch(() => null);
      }

      // If still idle, make sure we're hovering
      if (className?.includes("price-idle")) {
        await simulateHover(page, `.price-block`);
      }

      await page.waitForTimeout(300);
    } catch {
      await page.waitForTimeout(300);
    }
  }

  return null;
}

// ─── Read stock from DOM ──────────────────────────────────────────────────────

async function readStockFromPage(
  page: import("playwright").Page,
  stockClass: string,
): Promise<string> {
  // Try store's stock badge first
  const selectors = [
    stockClass ? `.${stockClass}` : null,
    ".stock-badge",
    "[class*='stock']",
    "[class*='Stock']",
  ].filter(Boolean) as string[];

  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      const text = await el.textContent({ timeout: 3000 }).catch(() => null);
      if (text?.trim()) return text.trim();
    } catch {
      // try next selector
    }
  }
  return "";
}

// ─── Main scrape function ─────────────────────────────────────────────────────

/**
 * Scrape price and stock for a single product using Playwright.
 *
 * @param productId  - The store integer id (e.g. 852)
 * @param productSlug - The store slug (e.g. "basecamp-indoor-camera-xl")
 * @param lastPrice  - Last known price for jump detection (null if first scrape)
 * @param headless   - Whether to run headless (default true for production)
 * @param slowMo     - Playwright slowMo delay in ms (for headed/demo runs)
 * @param stabilityIntervalMs - Delay between two price reads for stability check
 */
export async function scrapeProductPrice(
  productId: string,
  productSlug: string,
  lastPrice: number | null,
  headless = true,
  slowMo = 0,
  stabilityIntervalMs = 750,
): Promise<ScrapeOutcome> {
  const env = getEnv();
  const url = `${env.STORE_BASE_URL}/product/${productSlug}`;

  if (!env.ENABLE_BROWSER) {
    return {
      ok: false,
      errorType: "BROWSER_ERROR",
      errorMessage: "ENABLE_BROWSER is false — Playwright not available",
    };
  }

  let browser: import("playwright").Browser | null = null;
  let page: import("playwright").Page | null = null;

  try {
    browser = await getBrowser(headless, slowMo);
    const context = await browser.newContext({
      // Realistic viewport and user-agent
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    page = await context.newPage();

    // ── Navigate to product page ──────────────────────────────────────────
    logger.info(`Navigating to ${url}`);
    const navResponse = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: env.SCRAPE_TIMEOUT_MS,
    });

    if (!navResponse) {
      return { ok: false, errorType: "BROWSER_ERROR", errorMessage: "No navigation response" };
    }

    const httpStatus = navResponse.status();
    if (httpStatus === 404) {
      throw new HttpError(404, `Product page not found: ${url}`);
    }
    if (httpStatus >= 500) {
      throw new HttpError(httpStatus, `Server error ${httpStatus} on ${url}`);
    }

    // ── Fetch layout for current CSS class names ──────────────────────────
    const layout = await fetchLayout(env.STORE_BASE_URL);
    if (!layout) {
      return {
        ok: false,
        errorType: "STRUCTURE_CHANGED",
        errorMessage: "/api/layout did not return expected classes — structure may have changed",
      };
    }

    const priceValueClass = layout.priceValue;
    const stockClass = layout.stock;
    const priceWrapClass = layout.priceWrap;

    // Selectors built from current layout revision (not hardcoded!)
    const priceWrapSelector = `.price-block`;
    const priceValueSelector = `.${priceValueClass}, .price-block b, .price-block span`;

    // ── Wait for price area to be visible ──────────────────────────────────
    await page.waitForSelector(priceWrapSelector, { timeout: 15000 }).catch(() => {
      logger.warn("Price wrap selector not found — structure may have changed");
    });

    // ── Simulate hover to unlock price ─────────────────────────────────────
    logger.info(`Hovering over price area to unlock...`);
    const hoverOk = await simulateHover(page, priceWrapSelector);
    if (!hoverOk) {
      logger.warn("Hover simulation failed — price area not found in DOM");
    }

    // ── Wait for price to reach 'success' phase ────────────────────────────
    const priceBlockText = await waitForPriceReady(page, priceWrapSelector, 20000);

    if (!priceBlockText) {
      return {
        ok: false,
        errorType: "TIMEOUT",
        errorMessage: "Price widget did not reach 'success' phase within timeout",
      };
    }

    // ── Read the raw price text from the price-value element ───────────────
    let rawPrice = "";
    // Try the dynamic class selector first, then fallback
    const priceSelectors = [
      `.${priceValueClass}`,
      ".price-block b",
      ".price-block [class*='pv-']",
    ];
    for (const sel of priceSelectors) {
      rawPrice = (await page.locator(sel).first().textContent({ timeout: 3000 }).catch(() => "")) ?? "";
      if (rawPrice.trim()) break;
    }

    // Check if the price element exists at all (structure change detection)
    if (!rawPrice.trim()) {
      return {
        ok: false,
        errorType: "STRUCTURE_CHANGED",
        errorMessage: `Price value element (${priceValueClass}) not found or empty after unlock`,
      };
    }

    // ── First stability read ───────────────────────────────────────────────
    const parseResult1 = parsePrice(rawPrice);
    if (!parseResult1.ok) {
      return {
        ok: false,
        errorType: "PARSE_ERROR",
        errorMessage: `First read parse failed: ${parseResult1.reason}`,
      };
    }

    // ── Wait briefly then do second stability read ─────────────────────────
    await page.waitForTimeout(stabilityIntervalMs);

    let rawPrice2 = "";
    for (const sel of priceSelectors) {
      rawPrice2 = (await page.locator(sel).first().textContent({ timeout: 3000 }).catch(() => "")) ?? "";
      if (rawPrice2.trim()) break;
    }

    const parseResult2 = parsePrice(rawPrice2);
    if (!parseResult2.ok) {
      return {
        ok: false,
        errorType: "PARSE_ERROR",
        errorMessage: `Second read parse failed: ${parseResult2.reason}`,
      };
    }

    // ── Stability check: both reads must agree ─────────────────────────────
    if (!pricesAgree(parseResult1.price, parseResult2.price)) {
      return {
        ok: false,
        errorType: "SUSPICIOUS_VALUE",
        errorMessage:
          `Price unstable: first=${parseResult1.price}, second=${parseResult2.price}. ` +
          `Values disagree after ${stabilityIntervalMs}ms.`,
      };
    }

    const price = parseResult1.price;

    // ── Sanity check: flag large price jumps but still store them ──────────
    // (re-verification is done by the caller in scrapeWithRetry)
    const isJump = isPriceJump(price, lastPrice, env.PRICE_JUMP_THRESHOLD);
    if (isJump) {
      logger.warn("Price jump detected", {
        productId,
        lastPrice,
        newPrice: price,
        threshold: env.PRICE_JUMP_THRESHOLD,
      });
    }

    // ── Read stock ─────────────────────────────────────────────────────────
    const rawStock = await readStockFromPage(page, stockClass);

    await context.close();

    return {
      ok: true,
      data: {
        price,
        stock: normalizeStock(rawStock),
        rawPrice: rawPrice.trim(),
        rawStock: rawStock.trim(),
        ...(isJump && { priceJumpFlagged: true } as any),
      },
    };
  } catch (err: unknown) {
    await page?.close().catch(() => {});

    if (err instanceof HttpError) {
      return {
        ok: false,
        errorType: "HTTP_ERROR",
        errorMessage: err.message,
        httpStatus: err.status,
      };
    }
    if (err instanceof TimeoutError) {
      return { ok: false, errorType: "TIMEOUT", errorMessage: err.message };
    }

    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, errorType: "BROWSER_ERROR", errorMessage: message };
  }
}
