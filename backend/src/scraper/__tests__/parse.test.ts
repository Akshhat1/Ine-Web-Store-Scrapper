// backend/src/scraper/__tests__/parse.test.ts
// Unit tests for price parsing, stock normalization, stability check,
// price-jump detection, and scrape-log status decision logic.

import { describe, it, expect } from "vitest";
import {
  parsePrice,
  normalizeStock,
  pricesAgree,
  isPriceJump,
  type StockStatus,
} from "../parse.js";
import { withRetry, HttpError, TimeoutError } from "../fetch.js";

// ─── parsePrice ───────────────────────────────────────────────────────────────

describe("parsePrice", () => {
  it("parses a simple number", () => {
    const r = parsePrice("1299");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.price).toBe(1299);
  });

  it("parses price with currency symbol ₹", () => {
    const r = parsePrice("₹1,299.00");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.price).toBe(1299);
  });

  it("parses $1,299.00", () => {
    const r = parsePrice("$1,299.00");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.price).toBe(1299);
  });

  it("parses price with whitespace padding", () => {
    const r = parsePrice("  ₹ 499.50  ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.price).toBe(499.5);
  });

  it("rejects N/A", () => {
    const r = parsePrice("N/A");
    expect(r.ok).toBe(false);
  });

  it("rejects empty string", () => {
    const r = parsePrice("");
    expect(r.ok).toBe(false);
  });

  it("rejects null", () => {
    const r = parsePrice(null);
    expect(r.ok).toBe(false);
  });

  it("rejects undefined", () => {
    const r = parsePrice(undefined);
    expect(r.ok).toBe(false);
  });

  it("rejects zero", () => {
    const r = parsePrice("0");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/validation/i);
  });

  it("rejects negative numbers", () => {
    const r = parsePrice("-100");
    expect(r.ok).toBe(false);
  });

  it("rejects NaN-like strings", () => {
    const r = parsePrice("abc");
    expect(r.ok).toBe(false);
  });

  it("rejects 'loading' placeholder text", () => {
    const r = parsePrice("loading…");
    expect(r.ok).toBe(false);
  });

  it("rejects 'Price hidden' placeholder", () => {
    const r = parsePrice("Price hidden");
    expect(r.ok).toBe(false);
  });

  it("rejects prices with more than 2 decimal places", () => {
    const r = parsePrice("1299.999");
    expect(r.ok).toBe(false);
  });

  it("accepts exactly 2 decimal places", () => {
    const r = parsePrice("1299.99");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.price).toBe(1299.99);
  });

  it("accepts 1 decimal place", () => {
    const r = parsePrice("₹49.5");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.price).toBe(49.5);
  });
});

// ─── normalizeStock ───────────────────────────────────────────────────────────

describe("normalizeStock", () => {
  it("recognizes 'In stock'", () => {
    expect(normalizeStock("In stock")).toBe("in_stock");
  });

  it("recognizes 'Out of stock'", () => {
    expect(normalizeStock("Out of stock")).toBe("out_of_stock");
  });

  it("recognizes 'Low stock'", () => {
    expect(normalizeStock("Low stock")).toBe("low_stock");
  });

  it("recognizes 'only 3 left'", () => {
    expect(normalizeStock("only 3 left")).toBe("low_stock");
  });

  it("returns unknown for ambiguous text", () => {
    expect(normalizeStock("check availability")).toBe("unknown");
  });

  it("returns unknown for null", () => {
    expect(normalizeStock(null)).toBe("unknown");
  });

  it("returns unknown for empty string", () => {
    expect(normalizeStock("")).toBe("unknown");
  });

  it("is case-insensitive", () => {
    expect(normalizeStock("IN STOCK")).toBe("in_stock");
    expect(normalizeStock("OUT OF STOCK")).toBe("out_of_stock");
  });
});

// ─── pricesAgree (stability check) ───────────────────────────────────────────

describe("pricesAgree", () => {
  it("agrees on identical prices", () => {
    expect(pricesAgree(1299, 1299)).toBe(true);
  });

  it("agrees within floating-point noise", () => {
    expect(pricesAgree(1299.0, 1299.000001)).toBe(true);
  });

  it("disagrees on different prices", () => {
    expect(pricesAgree(1299, 1300)).toBe(false);
  });

  it("disagrees even on small differences", () => {
    expect(pricesAgree(1299.0, 1299.01)).toBe(false);
  });
});

// ─── isPriceJump ──────────────────────────────────────────────────────────────

describe("isPriceJump", () => {
  it("returns false when no last price (first scrape)", () => {
    expect(isPriceJump(1299, null, 0.5)).toBe(false);
    expect(isPriceJump(1299, undefined, 0.5)).toBe(false);
  });

  it("returns false for normal price change within threshold", () => {
    expect(isPriceJump(1350, 1299, 0.5)).toBe(false); // ~3.9% change
  });

  it("returns true when price jumps beyond threshold", () => {
    expect(isPriceJump(2000, 1000, 0.5)).toBe(true); // 100% change > 50%
  });

  it("returns true for >50% price drop", () => {
    expect(isPriceJump(400, 1000, 0.5)).toBe(true); // 60% drop
  });

  it("uses configurable threshold", () => {
    // With 0.1 (10%) threshold, a 15% change should trigger
    expect(isPriceJump(1150, 1000, 0.1)).toBe(true);
    // But a 9% change should not
    expect(isPriceJump(1090, 1000, 0.1)).toBe(false);
  });
});

// ─── withRetry (mocked) ───────────────────────────────────────────────────────

describe("withRetry", () => {
  it("returns result on first success", async () => {
    let calls = 0;
    const { result, attempts } = await withRetry(async () => {
      calls++;
      return "ok";
    }, { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(attempts).toBe(1);
    expect(calls).toBe(1);
  });

  it("retries on timeout error and eventually succeeds (RETRIED logic)", async () => {
    let calls = 0;
    const { result, attempts } = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new TimeoutError("timeout");
        return "recovered";
      },
      { maxRetries: 3, baseDelayMs: 1 },
    );
    expect(result).toBe("recovered");
    expect(attempts).toBe(3);
  });

  it("exhausts retries and throws last error (FAILED logic)", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new TimeoutError("always timeout");
        },
        { maxRetries: 2, baseDelayMs: 1 },
      ),
    ).rejects.toThrow("always timeout");
    expect(calls).toBe(3); // 1 initial + 2 retries
  });

  it("does NOT retry on 404 (product removed)", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new HttpError(404, "Not found");
        },
        { maxRetries: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1); // Must not retry
  });

  it("retries on 5xx errors", async () => {
    let calls = 0;
    const { result } = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw new HttpError(500, "Server error");
        return "ok";
      },
      { maxRetries: 3, baseDelayMs: 1 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("retries on 429 errors", async () => {
    let calls = 0;
    const { result } = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw new HttpError(429, "Rate limited");
        return "ok";
      },
      { maxRetries: 3, baseDelayMs: 1 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("calls onAttemptFailed callback for each failed attempt", async () => {
    const failures: number[] = [];
    await withRetry(
      async (attempt) => {
        if (attempt < 3) throw new TimeoutError("t");
        return "done";
      },
      {
        maxRetries: 3,
        baseDelayMs: 1,
        onAttemptFailed: (attempt) => failures.push(attempt),
      },
    );
    expect(failures).toEqual([1, 2]);
  });
});

// ─── Log status decision logic ────────────────────────────────────────────────

describe("Log status decision logic", () => {
  // The rule: SUCCESS if attempt=1 and ok, RETRIED if attempt>1 and ok, FAILED if never ok
  function determineStatus(
    finalAttempt: number,
    succeeded: boolean,
  ): "SUCCESS" | "RETRIED" | "FAILED" {
    if (!succeeded) return "FAILED";
    return finalAttempt === 1 ? "SUCCESS" : "RETRIED";
  }

  it("SUCCESS when first attempt works", () => {
    expect(determineStatus(1, true)).toBe("SUCCESS");
  });

  it("RETRIED when second attempt works", () => {
    expect(determineStatus(2, true)).toBe("RETRIED");
  });

  it("RETRIED when fourth attempt works", () => {
    expect(determineStatus(4, true)).toBe("RETRIED");
  });

  it("FAILED when all attempts fail", () => {
    expect(determineStatus(4, false)).toBe("FAILED");
    expect(determineStatus(1, false)).toBe("FAILED");
  });
});
