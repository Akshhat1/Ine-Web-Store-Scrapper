# Phase 0 Reconnaissance — demo.inelabteamdev.com

**Performed:** 2026-09-20  
**Method:** Raw HTTP fetches + JavaScript bundle static analysis  

---

## 1. Site Architecture

The root URL returns a near-empty React/Vite SPA shell — `<div id="root"></div>` with no product data. Content is entirely client-rendered by the JavaScript bundle. **A plain `fetch` of the root URL returns no product data.**

---

## 2. Discovered API Endpoints

Found by grepping the minified JS bundle for `fetch(` calls.

### 2a. Catalog — `GET /api/catalog`

**Parameters:** `page` (1-indexed), `pageSize` (integer)  
**Total products:** 1000 (IDs 1–1000)

**NOTE:** `?q=` and `?search=` params are **silently ignored**. Search is client-side only.

**Sample response:**
```json
{
  "page": 1, "pageSize": 10, "pages": 100, "total": 1000,
  "items": [{
    "id": 852, "slug": "basecamp-indoor-camera-xl",
    "name": "Basecamp Indoor Camera XL",
    "brand": "Basecamp", "category": "Smart Home",
    "sku": "BAS-10852",
    "description": "The Basecamp Indoor Camera XL..."
  }]
}
```

**Stable ID:** integer `id` (1–1000). 404 for id > 1000.

### 2b. Layout — `GET /api/layout`

Returns rotating CSS class names used by the price widget. The `revision` and class names rotate periodically.

```json
{
  "revision": 626004, "variant": 2,
  "validUntil": 1789862400000,
  "classes": {
    "priceWrap": "pw-q9", "priceValue": "pv-q9",
    "mrp": "mr-q9", "sale": "sl-q9", "badge": "bd-q9",
    "rating": "rt-q9", "seller": "sr-q9",
    "delivery": "dl-q9", "stock": "st-q9"
  },
  "priceTag": "b", "priceCarrier": "text"
}
```

**Class names rotate** — using static selectors would break. Use `priceValue` from this endpoint.

### 2c. Product Detail — `GET /api/product/:id`

Accepts integer id only (slug returns 404). Returns metadata — **NO price, NO stock**.

```json
{
  "id": 852, "slug": "basecamp-indoor-camera-xl",
  "name": "Basecamp Indoor Camera XL",
  "brand": "Basecamp", "category": "Smart Home",
  "sku": "BAS-10852", "description": "...",
  "specs": { "warranty": "...", "material": "...", "colour": "Graphite", ... },
  "reviews": [...]
}
```

**No image_url in any API response.** Stored as null.

---

## 3. Price & Stock — Anti-Scraping Protection

### Mechanism (reverse-engineered from bundle)

The price is behind a 5-layer bot-detection wall:

1. **Mouse hover tracking** — requires ≥8 mouse moves over the price area + ≥600ms dwell time
2. **Canvas fingerprinting** — renders a specific canvas with "INE store ✓ price ₹ 42.9"
3. **WebGL fingerprinting** — GPU vendor/renderer/version hash
4. **Frame timing** — `requestAnimationFrame` timing over 8 frames
5. **WebAssembly proof-of-work** — WASM compute challenge verified server-side

### Price Fetch Flow

```
1. GET <obfuscated-challenge-url>  → { wasm_bytes_b64, nonce, ... }
2. Run WASM module(nonce) → proof answer
3. POST <obfuscated-verify-url>
   body: { hoverAt, dwellMs, moves[], canvas_fp, webgl_fp,
           frames[], hardwareConcurrency, screen[], answer, productId }
   → { token }
4. GET <obfuscated-listings-url>/:productId
   Authorization: Bearer <token>
   → { e: <xor-encrypted-bytes-b64> }
5. XOR decrypt with key(token+nonce) → {
     p: price (shown), m: mrp, n: sale, b: badge_pct,
     s: stock, c: currency, t: timestamp, r: rating,
     g: pending_flag (1=not ready yet)
   }
```

### Price Widget States

| Phase     | Display                              |
|-----------|--------------------------------------|
| `idle`    | "Price hidden" — must hover first    |
| `loading` | Spinner (opacity 0.45 on price area) |
| `success` | Actual price rendered in DOM         |

**`pending` flag (field `g`):** When `g=1`, price is transitional — treat as NOT READY, retry.

---

## 4. Stress Test Results

**Catalog API** (15 sequential requests):
- All HTTP 200
- Latency: 82–249 ms (median ~88 ms)
- No errors, no rate limiting observed

**Product API** (15 products):
- All HTTP 200 for IDs 1–1000
- HTTP 404 for IDs > 1000 (`{"error":"not_found"}`)
- Latency: 84–99 ms

**Price endpoint:** Cannot stress-test without browser session.

---

## 5. Decision: HTTP vs Playwright

**DECISION: Playwright is the PRIMARY scraper for price/stock.**

- Catalog search and product metadata → plain HTTP (fast, reliable)
- Price and stock → Playwright required (bot detection cannot be replicated with raw fetch)
- Playwright gated behind `ENABLE_BROWSER=true` env var
- Single browser instance, sequential product processing (RAM constraint)
- CSS selectors derived from `/api/layout` `priceValue` class (not hardcoded)

---

## 6. Structural Change Indicators

| Indicator | What Changes | Our Response |
|-----------|-------------|--------------|
| `/api/layout` revision changes | CSS class names rotate | Re-fetch layout before each scrape; if class missing → `STRUCTURE_CHANGED` |
| Challenge endpoint URL changes | All price fetches fail 401 | Log `STRUCTURE_CHANGED` on consistent 401/403 |
| `minMoves`/`minDwellMs` increase | Hover sim insufficient | Log `FAILED`, flag for manual review |
| Total product count changes | Cache invalidated | Handle 404 on known IDs as product removed |

---

## 7. Search Strategy

Since server-side search is absent, our backend will:
1. Fetch all 1000 products in 10 requests (`pageSize=100`) and cache in memory for 1 hour
2. Filter by case-insensitive substring match on `name`, `brand`, `category`
3. Return top 20 results to the frontend search
