// backend/src/scraper/parse.ts
// Price and stock parsing, validation, and normalization.
// All price parsing logic is in one testable module with no side effects.

import { z } from "zod";

// ─── Stock normalization ─────────────────────────────────────────────────────

export type StockStatus = "in_stock" | "out_of_stock" | "low_stock" | "unknown";

/**
 * Normalize a raw stock string (from DOM text, badge, etc.) to our enum.
 * When ambiguous, returns 'unknown' — we never guess.
 */
export function normalizeStock(raw: string | null | undefined): StockStatus {
  if (!raw) return "unknown";

  const s = raw.trim().toLowerCase();

  if (
    s.includes("in stock") ||
    s.includes("instock") ||
    s === "available" ||
    s === "in-stock"
  ) {
    return "in_stock";
  }

  if (
    s.includes("out of stock") ||
    s.includes("outofstock") ||
    s.includes("out-of-stock") ||
    s === "unavailable" ||
    s === "sold out"
  ) {
    return "out_of_stock";
  }

  if (
    s.includes("low stock") ||
    s.includes("limited stock") ||
    s.includes("only") ||
    s.includes("few left") ||
    s.includes("hurry")
  ) {
    return "low_stock";
  }

  return "unknown";
}

// ─── Price parsing ────────────────────────────────────────────────────────────

// Zod schema for a valid scraped price (positive finite number, ≤2 decimals)
const priceSchema = z
  .number()
  .finite()
  .positive()
  .refine((n) => {
    // At most 2 decimal places
    const decimals = n.toString().split(".")[1]?.length ?? 0;
    return decimals <= 2;
  }, "Price must have at most 2 decimal places");

export type ParsePriceResult =
  | { ok: true; price: number }
  | { ok: false; reason: string };

/**
 * Strictly parse a raw price string into a validated number.
 * Handles: currency symbols (₹, $, €, £), thousands separators, whitespace.
 * Rejects: empty, "N/A", "loading", zero, negative, NaN, >2 decimals.
 */
export function parsePrice(raw: string | null | undefined): ParsePriceResult {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return { ok: false, reason: "Empty price string" };
  }

  const trimmed = raw.trim();

  // Reject obvious non-price text
  const rejectPhrases = [
    "n/a", "na", "loading", "price hidden", "check", "–", "—",
    "tbd", "contact", "call", "see", "enquire",
  ];
  if (rejectPhrases.some((p) => trimmed.toLowerCase().includes(p))) {
    return { ok: false, reason: `Non-price text: "${trimmed}"` };
  }

  // Strip currency symbols and thousands separators (commas in en-IN format)
  // Keep: digits, one dot, optional leading minus
  const stripped = trimmed
    .replace(/[₹$€£¥₩]/g, "")      // currency symbols
    .replace(/,/g, "")              // thousands separators (1,299 → 1299)
    .replace(/\s/g, "")             // whitespace
    .trim();

  // Must look like a number (optional minus, digits, optional decimal)
  if (!/^-?\d+(\.\d+)?$/.test(stripped)) {
    return { ok: false, reason: `Cannot parse as number: "${raw}"` };
  }

  const num = parseFloat(stripped);

  if (!isFinite(num)) {
    return { ok: false, reason: `Non-finite number: "${raw}"` };
  }

  const validation = priceSchema.safeParse(num);
  if (!validation.success) {
    return {
      ok: false,
      reason: `Validation failed: ${validation.error.issues[0]?.message ?? "unknown"} (value: ${num})`,
    };
  }

  return { ok: true, price: validation.data };
}

// ─── Stability check ─────────────────────────────────────────────────────────

/**
 * Returns true if two price readings agree (same value).
 * Used for the stability read: read price twice with a short interval;
 * only accept if both reads agree.
 */
export function pricesAgree(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005; // tolerate floating-point noise
}

// ─── Sanity / price-jump check ────────────────────────────────────────────────

/**
 * Returns true if the new price deviates more than `threshold` (fraction)
 * from the last known price. Used to flag suspicious values for re-verification.
 *
 * Example: threshold=0.5 → flag if price changes by >50%
 */
export function isPriceJump(
  newPrice: number,
  lastPrice: number | null | undefined,
  threshold: number,
): boolean {
  if (lastPrice === null || lastPrice === undefined || lastPrice <= 0) {
    return false; // no reference price — first scrape, always accept
  }
  const change = Math.abs(newPrice - lastPrice) / lastPrice;
  return change > threshold;
}
