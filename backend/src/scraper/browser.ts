// backend/src/scraper/browser.ts
// Playwright-based price/stock scraper for demo.inelabteamdev.com
//
// STORE ANTI-BOT ANALYSIS (from JS bundle reverse engineering):
//   1. Prices are XOR-encrypted and loaded via WASM proof-of-work challenge
//   2. The challenge endpoint: GET /oRfkG775650coPFdage (rotates per revision)
//   3. Token endpoint: POST /ation/hallen
//   4. Price endpoint: GET /MLQOTNUYXks/{productId}ZuzJW (with Bearer token)
//   5. Price widget requires minMoves=8 mouse moves over minDwellMs=600ms
//   6. The .price-block element cycles: price-idle → price-loading → price-success
//   7. CSS classes rotate per /api/layout revision (priceValue, stock, etc.)
//
// PLAYWRIGHT STRATEGY:
//   - Navigate to product page (full SPA hydration required for WASM)
//   - Wait for .price-block to appear
//   - Simulate realistic mouse hover (12+ moves, 750ms total dwell)
//   - Wait for price-success class on .price-block (up to 25s)
//   - Extract price using dynamic CSS class from /api/layout
//   - Extract stock from stock badge (.stock-badge)
//   - Double-read for stability confirmation
//
// MEMORY SAFETY:
//   - ONE browser instance per process (lazy singleton)
//   - Products scraped sequentially (never parallel)
//   - Context closed after each scrape to prevent memory leak

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

  _browser = await chromium.launch({
    headless,
    slowMo,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-web-security",
      "--disable-features=IsolateOrigins",
    ],
  });
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
 * We use 14 moves over 900ms with small random offsets for realism.
 * After hover, we click the "Reveal price" button if present & enabled.
 *
 * Returns true if hover succeeded.
 */
async function simulateHoverOnPriceBlock(
  page: import("playwright").Page,
): Promise<boolean> {
  try {
    // Wait for the price-block element
    const priceBlock = page.locator(".price-block").first();
    await priceBlock.waitFor({ state: "attached", timeout: 20000 });

    // Scroll it into view first
    await priceBlock.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});

    const box = await priceBlock.boundingBox();
    if (!box) {
      logger.warn("Price block has no bounding box");
      return false;
    }

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Move mouse from far away toward the element
    await page.mouse.move(cx - 100, cy - 60, { steps: 5 });
    await page.waitForTimeout(80);

    // Simulate 14 moves across the price block with realistic jitter
    // This exceeds the minMoves=8 requirement
    const moveCount = 14;
    const totalDurationMs = 900; // exceeds minDwellMs=600
    const delayPerMove = Math.floor(totalDurationMs / moveCount);

    for (let i = 0; i < moveCount; i++) {
      const progress = i / (moveCount - 1);
      // Lissajous-like path across the element for more natural movement
      const dx = Math.sin(progress * Math.PI * 2) * box.width * 0.35;
      const dy = Math.cos(progress * Math.PI * 1.5) * box.height * 0.35;
      await page.mouse.move(cx + dx, cy + dy, { steps: 2 });
      await page.waitForTimeout(delayPerMove + Math.random() * 30);
    }

    // Final hover on center
    await page.mouse.move(cx, cy);
    await page.waitForTimeout(150);

    // Click the "Reveal price" button if present and enabled
    const revealBtn = priceBlock.locator("button").first();
    if (await revealBtn.isVisible().catch(() => false)) {
      const isDisabled = await revealBtn.getAttribute("disabled").catch(() => null);
      if (isDisabled === null) {
        logger.info("Clicking Reveal Price button after hover");
        await revealBtn.click().catch(() => {});
      }
    }

    return true;
  } catch (err) {
    logger.warn("Hover simulation failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ─── Wait for price to reach success phase ────────────────────────────────────

/**
 * Polls the .price-block element until it has the 'price-success' class.
 * Also keeps simulating hover / clicking button while in 'price-idle' or 'price-loading' state.
 *
 * Returns the inner text of the price block when success, or null on timeout.
 */
async function waitForPriceSuccess(
  page: import("playwright").Page,
  timeoutMs: number,
): Promise<{ priceText: string; blockText: string } | null> {
  const deadline = Date.now() + timeoutMs;
  let hoverResimulated = false;

  while (Date.now() < deadline) {
    try {
      const priceBlock = page.locator(".price-block").first();
      const className = await priceBlock.getAttribute("class", { timeout: 3000 }).catch(() => null);

      if (!className) {
        await page.waitForTimeout(500);
        continue;
      }

      if (className.includes("price-success")) {
        // Success! Extract price text
        const blockText = await priceBlock.innerText({ timeout: 3000 }).catch(() => "");
        // Also try to get just the price value span
        const priceValueEl = priceBlock.locator("[class*='pv-']").first();
        const priceText = (await priceValueEl.textContent({ timeout: 2000 }).catch(() => null)) ?? blockText;
        return { priceText: priceText.trim(), blockText: blockText.trim() };
      }

      if (className.includes("price-error")) {
        logger.warn("Price block reached error state");
        return null;
      }

      // If in price-idle state, attempt to click Reveal button or re-simulate hover
      if (className.includes("price-idle")) {
        const revealBtn = priceBlock.locator("button").first();
        if (await revealBtn.isVisible().catch(() => false)) {
          const isDisabled = await revealBtn.getAttribute("disabled").catch(() => null);
          if (isDisabled === null) {
            logger.info("Clicking Reveal Price button in wait loop");
            await revealBtn.click().catch(() => {});
          }
        }

        if (!hoverResimulated) {
          logger.info("Price still idle, re-simulating hover");
          await simulateHoverOnPriceBlock(page);
          hoverResimulated = true;
        }
      } else {
        // In price-loading or price-retrying state: let SPA internal fetch/retry complete
        logger.info("Price widget loading/retrying, waiting...", { className });
      }

      await page.waitForTimeout(500);
    } catch {
      await page.waitForTimeout(500);
    }
  }

  return null;
}

// ─── Extract price from page ──────────────────────────────────────────────────

/**
 * Tries multiple selectors to extract the raw price text from the page.
 * Uses dynamic class from layout API, plus fallback selectors.
 */
async function extractRawPrice(
  page: import("playwright").Page,
  priceValueClass: string,
  blockText: string,
): Promise<string> {
  const selectors = [
    // Dynamic class from layout API
    `.${priceValueClass}`,
    // Generic price value selectors
    ".price-block [class^='pv-']",
    ".price-block [class*='pv-']",
    ".price-block b",
    ".price-block strong",
    // Last resort: parse from block text
  ];

  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      const text = await el.textContent({ timeout: 2000 }).catch(() => null);
      if (text?.trim()) {
        const parsed = parsePrice(text.trim());
        if (parsed.ok) return text.trim();
      }
    } catch {
      // try next
    }
  }

  // Fallback: try to parse price from block text (contains price + other info)
  // The price is typically a number like ₹1,299 somewhere in the text
  const priceMatch = blockText.match(/[₹$€£]?\s*[\d,]+(?:\.\d{1,2})?/);
  if (priceMatch) return priceMatch[0].trim();

  return "";
}

// ─── Extract stock from page ──────────────────────────────────────────────────

async function extractStock(
  page: import("playwright").Page,
  stockClass: string,
): Promise<string> {
  const selectors = [
    stockClass ? `.${stockClass}` : null,
    ".stock-badge",
    ".stock-badge.in-stock",
    ".stock-badge.out-stock",
    "[class*='stock-badge']",
    ".price-block [class*='stock']",
    "[class*='stock']:not(.price-block)",
  ].filter(Boolean) as string[];

  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      const text = await el.textContent({ timeout: 3000 }).catch(() => null);
      if (text?.trim()) return text.trim();
    } catch {
      // try next
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
  stabilityIntervalMs = 1000,
): Promise<ScrapeOutcome> {
  const env = getEnv();
  
  // Construct destination URL:
  // The store React SPA uses numeric ID for routes: /product/:id (e.g. /product/301)
  let url: string;
  if (productSlug.startsWith("http://") || productSlug.startsWith("https://")) {
    url = productSlug;
  } else if (/^\d+$/.test(productSlug)) {
    url = `${env.STORE_BASE_URL}/product/${productSlug}`;
  } else if (/^\d+$/.test(productId)) {
    url = `${env.STORE_BASE_URL}/product/${productId}`;
  } else {
    url = `${env.STORE_BASE_URL}/product/${productSlug}`;
  }

  if (!env.ENABLE_BROWSER) {
    return {
      ok: false,
      errorType: "BROWSER_ERROR",
      errorMessage: "ENABLE_BROWSER is false — Playwright not available",
    };
  }

  let context: import("playwright").BrowserContext | null = null;
  let page: import("playwright").Page | null = null;

  try {
    const browser = await getBrowser(headless, slowMo);
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      // Spoof automation detection
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    // Override navigator.webdriver to avoid detection
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    page = await context.newPage();

    // ── Navigate to product page ──────────────────────────────────────────
    logger.info(`Navigating to ${url}`, { productId, productSlug });

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

    // ── Check if store SPA failed to load product (e.g. 429 rate limit) ─────────
    const initialBody = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
    if (
      initialBody.includes("Couldn’t load this product") ||
      initialBody.includes("Couldn't load this product") ||
      initialBody.includes("Error: product")
    ) {
      const match = initialBody.match(/Error: product (\d+)/);
      const errCode = match ? parseInt(match[1], 10) : 429;
      logger.warn(`Store SPA rendered product load error ${errCode}`, {
        productId,
        bodyPreview: initialBody.slice(0, 150),
      });
      throw new HttpError(errCode, `Store SPA product load error ${errCode}`);
    }

    // ── Wait for React SPA to hydrate — price block must appear ──────────────
    // The store is a Vite+React SPA; we need to wait for JS to execute and
    // render the product page including the price widget.
    logger.info("Waiting for React SPA to hydrate price block...");
    try {
      await page.waitForSelector(".price-block", {
        state: "attached",
        timeout: 15000,
      });
      logger.info("Price block found in DOM");
    } catch {
      // Check if page displays error text now
      const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
      if (
        bodyText.includes("Couldn’t load this product") ||
        bodyText.includes("Couldn't load this product") ||
        bodyText.includes("Error: product")
      ) {
        const match = bodyText.match(/Error: product (\d+)/);
        const errCode = match ? parseInt(match[1], 10) : 429;
        throw new HttpError(errCode, `Store SPA product load error ${errCode}`);
      }

      logger.warn("Price block not found within 15s", {
        bodyLength: bodyText.length,
        bodyPreview: bodyText.slice(0, 200),
      });
      // Try scrolling to trigger lazy rendering
      await page.evaluate(() => (globalThis as any).scrollTo(0, 300));
      await page.waitForTimeout(2000);
    }

    // Extra stability wait for any lazy-loaded JS
    await page.waitForTimeout(1000);

    // ── Fetch layout for current CSS class names (via HTTP, not browser) ──
    const layout = await fetchLayout(env.STORE_BASE_URL);
    if (!layout) {
      logger.warn("Layout API unavailable, using fallback selectors");
    }

    const priceValueClass = layout?.priceValue ?? "pv-k2";
    const stockClass = layout?.stock ?? "st-k2";

    // ── Simulate hover to unlock price ─────────────────────────────────────
    logger.info(`Simulating hover to unlock price widget`, { productId });
    await simulateHoverOnPriceBlock(page);

    // ── Wait for price-success (up to 35s to allow store client retries) ────
    const PRICE_WAIT_MS = 35000;
    logger.info(`Waiting for price-success state`, { productId, timeoutMs: PRICE_WAIT_MS });
    const priceData = await waitForPriceSuccess(page, PRICE_WAIT_MS);

    if (!priceData) {
      // Take debug screenshot if possible
      const screenshotPath = `/tmp/scrape-fail-${productId}-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath }).catch(() => {});

      // Try to get the current class to diagnose
      const currentClass = await page.locator(".price-block").first()
        .getAttribute("class", { timeout: 2000 })
        .catch(() => "unknown");

      return {
        ok: false,
        errorType: "TIMEOUT",
        errorMessage: `Price widget did not reach 'price-success' within ${PRICE_WAIT_MS}ms. Current class: ${currentClass}`,
      };
    }

    const { priceText: rawPriceFromWidget, blockText } = priceData;

    // ── Extract price from the widget ─────────────────────────────────────
    let rawPrice = await extractRawPrice(page, priceValueClass, blockText);

    // If extraction failed, try parsing from block text directly
    if (!rawPrice && rawPriceFromWidget) {
      rawPrice = rawPriceFromWidget;
    }

    if (!rawPrice.trim()) {
      return {
        ok: false,
        errorType: "STRUCTURE_CHANGED",
        errorMessage: `Could not extract price text from page. Block text: "${blockText.slice(0, 100)}"`,
      };
    }

    // ── First stability read ───────────────────────────────────────────────
    const parseResult1 = parsePrice(rawPrice);
    if (!parseResult1.ok) {
      return {
        ok: false,
        errorType: "PARSE_ERROR",
        errorMessage: `First read parse failed: ${parseResult1.reason} (raw: "${rawPrice}")`,
      };
    }

    // ── Wait briefly then do second stability read ─────────────────────────
    await page.waitForTimeout(stabilityIntervalMs);

    let rawPrice2 = await extractRawPrice(page, priceValueClass, blockText);
    if (!rawPrice2) rawPrice2 = rawPrice; // fallback to first read

    const parseResult2 = parsePrice(rawPrice2);
    if (!parseResult2.ok) {
      // If second read fails but first succeeded, use first (might be DOM update)
      logger.warn("Second read parse failed, using first read", {
        rawPrice2,
        reason: parseResult2.reason,
      });
      // Use first read as both
    }

    const price1 = parseResult1.price;
    const price2 = parseResult2.ok ? parseResult2.price : price1;

    // ── Stability check: both reads must agree ─────────────────────────────
    if (!pricesAgree(price1, price2)) {
      return {
        ok: false,
        errorType: "SUSPICIOUS_VALUE",
        errorMessage:
          `Price unstable: first=${price1}, second=${price2}. ` +
          `Values disagree after ${stabilityIntervalMs}ms.`,
      };
    }

    const price = price1;

    // ── Sanity check: flag large price jumps ──────────────────────────────
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
    const rawStock = await extractStock(page, stockClass);

    await context.close();
    context = null;

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
    if (context) await context.close().catch(() => {});

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
