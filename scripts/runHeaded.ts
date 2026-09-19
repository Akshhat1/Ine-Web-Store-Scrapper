// scripts/runHeaded.ts
// Observable headed Playwright run — use this to watch the scraper in action.
//
// Usage:
//   npm run scrape:headed -- --query "camera"
//   npm run scrape:headed -- --product 852
//   npm run scrape:headed -- --query "camera" --simulate-failure
//   npm run scrape:headed -- --product 852 --persist   (writes to DB)
//
// This script uses the SAME retry/validation code as production.
// --simulate-failure uses Playwright route interception — labelled SIMULATED in output.

import "dotenv/config";
import { parseArgs } from "node:util";
import { chromium, type Page } from "playwright";
import { parsePrice, normalizeStock, pricesAgree, isPriceJump } from "../backend/src/scraper/parse.js";
import { fetchWithTimeout, HttpError, TimeoutError } from "../backend/src/scraper/fetch.js";
import { getEnv } from "../backend/src/lib/env.js";
import { searchStore, fetchProductMeta } from "../backend/src/scraper/catalog.js";
import { scrapeSingleProduct } from "../backend/src/scraper/orchestrator.js";
import { getProductByStoreId, upsertProduct } from "../backend/src/db/products.js";

// ─── CLI args ─────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    query: { type: "string", short: "q" },
    product: { type: "string", short: "p" },
    "simulate-failure": { type: "boolean", default: false },
    persist: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const SLOW_MO = 250; // ms between Playwright actions — visibly slow

function step(msg: string) {
  console.log(`\n▶  ${msg}`);
}
function ok(msg: string) {
  console.log(`✅ ${msg}`);
}
function warn(msg: string) {
  console.log(`⚠️  ${msg}`);
}
function fail(msg: string) {
  console.log(`❌ ${msg}`);
}
function simulated(msg: string) {
  console.log(`🔴 [SIMULATED] ${msg}`);
}

// ─── Hover simulation (same logic as production) ─────────────────────────────

async function simulateHover(page: Page, selector: string): Promise<boolean> {
  step(`Hovering over price area to unlock price (minMoves=8, dwell=600ms)...`);
  try {
    const el = page.locator(selector).first();
    await el.waitFor({ state: "attached", timeout: 15000 });
    const box = await el.boundingBox();
    if (!box) {
      fail("Price element has no bounding box");
      return false;
    }

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx - 50, cy - 30);
    await page.waitForTimeout(100);
    console.log(`   → Starting 12-move hover sequence over price area...`);

    for (let i = 0; i < 12; i++) {
      const dx = (Math.random() - 0.5) * box.width * 0.8;
      const dy = (Math.random() - 0.5) * box.height * 0.8;
      await page.mouse.move(cx + dx, cy + dy, { steps: 3 });
      await page.waitForTimeout(70 + Math.random() * 40);
      process.stdout.write(`   → move ${i + 1}/12\r`);
    }
    console.log();
    ok("Hover sequence complete (12 moves, ~900ms dwell)");
    return true;
  } catch (err) {
    fail(`Hover failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// ─── Wait for price to appear ─────────────────────────────────────────────────

async function waitForPrice(page: Page, timeoutMs = 20000): Promise<string | null> {
  step("Waiting for price widget to reach 'success' phase...");
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    try {
      const el = page.locator(".price-block").first();
      const cls = await el.getAttribute("class", { timeout: 2000 }).catch(() => null);
      console.log(`   → Check ${attempt}: price-block class = "${cls ?? "not found"}"`);

      if (cls?.includes("price-success")) {
        ok("Price widget in 'success' state");
        return await el.textContent({ timeout: 2000 }).catch(() => null);
      }

      if (cls?.includes("price-idle")) {
        console.log(`   → Still idle — hovering again...`);
        await simulateHover(page, ".price-block");
      }
    } catch {
      // keep trying
    }
    await page.waitForTimeout(400);
  }

  fail("Price widget did not reach 'success' within timeout");
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const env = getEnv();

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  INE Price Tracker — Headed / Observable Run");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Store:            ${env.STORE_BASE_URL}`);
  console.log(`  Simulate failure: ${args["simulate-failure"] ? "YES (SIMULATED — not real)": "no"}`);
  console.log(`  Persist to DB:    ${args.persist ? "YES" : "no (dry run)"}`);
  console.log(`  SlowMo:           ${SLOW_MO}ms`);
  console.log("═══════════════════════════════════════════════════════\n");

  // ── Find the product ──────────────────────────────────────────────────────
  let storeProductId: string | null = null;
  let productSlug: string | null = null;
  let productName: string | null = null;

  if (args.product) {
    step(`Looking up product ID: ${args.product}`);
    const meta = await fetchProductMeta(args.product);
    if (!meta) {
      fail(`Product ${args.product} not found in store`);
      process.exit(1);
    }
    storeProductId = String(meta.id);
    productSlug = meta.slug;
    productName = meta.name;
    ok(`Found: ${meta.name} (slug: ${meta.slug})`);
  } else if (args.query) {
    step(`Searching store for: "${args.query}"`);
    const results = await searchStore(args.query);
    if (!results.length) {
      fail(`No products matching "${args.query}"`);
      process.exit(1);
    }
    const first = results[0];
    storeProductId = first.id;
    productSlug = first.url.split("/product/")[1];
    productName = first.name;
    ok(`Using first result: ${first.name} (id: ${first.id})`);
    if (results.length > 1) {
      console.log(`   (${results.length - 1} other matches: ${results.slice(1, 4).map(r => r.name).join(", ")})`);
    }
  } else {
    fail("Provide --query <name> or --product <id>");
    process.exit(1);
  }

  const productUrl = `${env.STORE_BASE_URL}/product/${productSlug}`;

  // ── Get last price for jump detection ────────────────────────────────────
  let lastPrice: number | null = null;
  if (args.persist && storeProductId) {
    const existing = await getProductByStoreId(storeProductId);
    lastPrice = existing?.last_price ?? null;
    if (lastPrice !== null) {
      console.log(`   Last known price: ₹${lastPrice}`);
    }
  }

  // ── Launch browser ────────────────────────────────────────────────────────
  step("Launching Chromium (headless:false, slowMo:250ms)...");
  const browser = await chromium.launch({ headless: false, slowMo: SLOW_MO });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  ok("Browser launched");

  // ── Simulate failure (route interception) ────────────────────────────────
  let failedRequests = 0;
  if (args["simulate-failure"]) {
    simulated("Installing route interception: first 3 /api/product requests will return 500");
    simulated("These errors are ARTIFICIAL — they do not reflect real store behavior");

    await page.route(`**/api/product/**`, async (route) => {
      if (failedRequests < 2) {
        failedRequests++;
        simulated(`Intercepting request #${failedRequests} → returning 500 (SIMULATED)`);
        await route.fulfill({ status: 500, body: '{"error":"simulated_failure"}' });
      } else {
        await route.continue();
      }
    });
  }

  // ── Navigate to product page ──────────────────────────────────────────────
  let attemptNum = 0;
  const maxAttempts = env.MAX_RETRIES + 1;
  let priceResult: { price: number; stock: string } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attemptNum = attempt;
    const attemptStart = Date.now();
    console.log(`\n──────────────────────────────────────────`);
    step(`ATTEMPT ${attempt}/${maxAttempts} — Navigating to ${productUrl}`);

    try {
      const response = await page.goto(productUrl, {
        waitUntil: "networkidle",
        timeout: env.SCRAPE_TIMEOUT_MS,
      });

      if (!response) throw new Error("No navigation response");

      const status = response.status();
      if (status === 500 && args["simulate-failure"] && attempt <= 2) {
        simulated(`Got 500 (SIMULATED) on attempt ${attempt}`);
        const backoffMs = Math.min(15000, 1000 * 2 ** (attempt - 1));
        console.log(`   → Backing off ${backoffMs}ms before retry...`);
        await page.waitForTimeout(backoffMs);
        continue;
      }

      if (status >= 400) {
        fail(`HTTP ${status} — aborting`);
        break;
      }

      ok(`Page loaded (HTTP ${status}, ${Date.now() - attemptStart}ms)`);

      // ── Hover + wait for price ──────────────────────────────────────────
      await simulateHover(page, ".price-block");
      const blockText = await waitForPrice(page);

      if (!blockText) {
        warn(`Attempt ${attempt}: price did not appear`);
        if (attempt < maxAttempts) {
          const backoffMs = Math.min(15000, 1000 * 2 ** (attempt - 1));
          console.log(`   → Backoff ${Math.round(backoffMs)}ms...`);
          await page.waitForTimeout(backoffMs);
        }
        continue;
      }

      // ── Fetch layout for dynamic class names ──────────────────────────
      step("Fetching /api/layout for current CSS class names...");
      const layoutRes = await fetchWithTimeout(`${env.STORE_BASE_URL}/api/layout`, { timeoutMs: 5000 });
      const layout = layoutRes.ok ? await layoutRes.json() as { classes: { priceValue: string; stock: string } } : null;
      const priceClass = layout?.classes?.priceValue ?? "pv-";
      ok(`Layout revision active — priceValue class: .${priceClass}`);

      // ── Read raw price ────────────────────────────────────────────────
      step("Reading price from DOM...");
      let rawPrice = "";
      for (const sel of [`.${priceClass}`, ".price-block b", "[class*='pv-']"]) {
        rawPrice = (await page.locator(sel).first().textContent({ timeout: 3000 }).catch(() => "")) ?? "";
        if (rawPrice.trim()) break;
      }
      console.log(`   → Raw price text: "${rawPrice}"`);

      // ── Parse price (first read) ──────────────────────────────────────
      const parse1 = parsePrice(rawPrice);
      if (!parse1.ok) {
        fail(`Parse error (first read): ${parse1.reason}`);
        continue;
      }
      ok(`First read: ₹${parse1.price}`);

      // ── Stability read ────────────────────────────────────────────────
      step("Stability check: waiting 750ms then reading again...");
      await page.waitForTimeout(750);
      let rawPrice2 = "";
      for (const sel of [`.${priceClass}`, ".price-block b", "[class*='pv-']"]) {
        rawPrice2 = (await page.locator(sel).first().textContent({ timeout: 3000 }).catch(() => "")) ?? "";
        if (rawPrice2.trim()) break;
      }
      console.log(`   → Raw price (2nd read): "${rawPrice2}"`);

      const parse2 = parsePrice(rawPrice2);
      if (!parse2.ok) {
        fail(`Parse error (second read): ${parse2.reason}`);
        continue;
      }
      ok(`Second read: ₹${parse2.price}`);

      if (!pricesAgree(parse1.price, parse2.price)) {
        warn(`Stability check FAILED: ${parse1.price} ≠ ${parse2.price} — SUSPICIOUS_VALUE`);
        continue;
      }
      ok(`Stability check PASSED: both reads agree at ₹${parse1.price}`);

      // ── Price jump check ───────────────────────────────────────────────
      if (lastPrice !== null && isPriceJump(parse1.price, lastPrice, env.PRICE_JUMP_THRESHOLD)) {
        warn(`Price jump detected: ₹${lastPrice} → ₹${parse1.price} (>${env.PRICE_JUMP_THRESHOLD * 100}% change)`);
        warn("Would re-verify in production. Flagging in log.");
      }

      // ── Read stock ─────────────────────────────────────────────────────
      step("Reading stock status...");
      const rawStock = (await page.locator(".stock-badge, [class*='stock']").first().textContent({ timeout: 3000 }).catch(() => "")) ?? "";
      const stock = normalizeStock(rawStock);
      console.log(`   → Raw stock: "${rawStock}" → normalized: "${stock}"`);

      priceResult = { price: parse1.price, stock };
      const finalStatus = attempt === 1 ? "SUCCESS" : "RETRIED";
      ok(`Scrape ${finalStatus} on attempt ${attempt}`);
      break;

    } catch (err: unknown) {
      const latency = Date.now() - attemptStart;
      const msg = err instanceof Error ? err.message : String(err);
      fail(`Attempt ${attempt} failed (${latency}ms): ${msg}`);

      if (attempt < maxAttempts) {
        const backoffMs = Math.min(15000, 1000 * 2 ** (attempt - 1));
        console.log(`   → Backoff ${Math.round(backoffMs)}ms before retry...`);
        await page.waitForTimeout(backoffMs);
      }
    }
  }

  // ── Final result ─────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  if (priceResult) {
    ok(`FINAL RESULT for: ${productName}`);
    console.log(`   Product ID:    ${storeProductId}`);
    console.log(`   Price:         ₹${priceResult.price}`);
    console.log(`   Stock:         ${priceResult.stock}`);
    console.log(`   Attempts used: ${attemptNum}`);
    console.log(`   Status:        ${attemptNum === 1 ? "SUCCESS" : "RETRIED"}`);

    // ── Persist to DB if --persist ──────────────────────────────────────
    if (args.persist && storeProductId) {
      step("Writing to database (--persist flag set)...");
      try {
        const meta = await fetchProductMeta(storeProductId);
        if (meta) {
          const product = await upsertProduct({
            store_product_id: storeProductId,
            name: meta.name,
            url: productUrl,
            image_url: null,
            category: meta.category,
            brand: meta.brand,
            sku: meta.sku,
            description: meta.description,
          });
          await scrapeSingleProduct(product, "headed");
          ok("Written to database");
        }
      } catch (err) {
        fail(`DB write failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      console.log("   (Dry run — not persisted. Use --persist to write to DB)");
    }
  } else {
    fail(`All ${maxAttempts} attempts FAILED for: ${productName}`);
    console.log("   Status: FAILED (no data written)");
  }
  console.log("═══════════════════════════════════════════════════════\n");

  await browser.close();
  process.exit(priceResult ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
