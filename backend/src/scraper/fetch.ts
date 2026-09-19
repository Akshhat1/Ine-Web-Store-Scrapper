// backend/src/scraper/fetch.ts
// Core reliability primitives:
//   fetchWithTimeout  – wraps fetch with an AbortController deadline
//   withRetry         – exponential backoff + jitter, up to MAX_RETRIES

import { getEnv } from "../lib/env.js";
import { logger } from "../lib/logger.js";

// ─── Error types ────────────────────────────────────────────────────────────

export class TimeoutError extends Error {
  readonly type = "TIMEOUT" as const;
}

export class HttpError extends Error {
  readonly type = "HTTP_ERROR" as const;
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class ParseError extends Error {
  readonly type = "PARSE_ERROR" as const;
}

export type ScraperError = TimeoutError | HttpError | ParseError | Error;

// ─── fetchWithTimeout ────────────────────────────────────────────────────────

/**
 * Fetches a URL with an AbortController timeout.
 * Throws TimeoutError on deadline exceeded, HttpError on non-2xx status.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = getEnv().SCRAPE_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new TimeoutError(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── withRetry ───────────────────────────────────────────────────────────────

interface RetryOptions {
  maxRetries?: number; // default: MAX_RETRIES env var
  baseDelayMs?: number; // default: 1000ms
  capDelayMs?: number; // default: 15000ms
  // Optional callback to observe each attempt — used for logging
  onAttemptFailed?: (attempt: number, error: ScraperError) => void;
}

function jitter(ms: number): number {
  // Add ±20% jitter to avoid thundering herd
  return ms * (0.8 + Math.random() * 0.4);
}

function shouldRetry(err: unknown): boolean {
  if (err instanceof HttpError) {
    // Retry on 5xx and 429; do NOT retry on 404 (product removed) or 401/403
    return err.status >= 500 || err.status === 429;
  }
  if (err instanceof TimeoutError) return true;
  // Network errors (ECONNREFUSED, etc.) — retry
  if (err instanceof TypeError) return true;
  return false;
}

/**
 * Wraps an async function with exponential backoff retry logic.
 * Returns { result, attempts } on success.
 * Throws the last error after exhausting retries.
 *
 * Retry-After header from 429 responses is respected when the fn throws
 * HttpError(429) — pass retryAfterMs via the error message as JSON.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<{ result: T; attempts: number }> {
  const maxRetries = opts.maxRetries ?? (process.env.MAX_RETRIES ? parseInt(process.env.MAX_RETRIES, 10) : 3);
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const capDelayMs = opts.capDelayMs ?? 15000;
  const totalAttempts = maxRetries + 1; // e.g. 3 retries = 4 total attempts

  let lastError: ScraperError = new Error("Unknown error");

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      const result = await fn(attempt);
      return { result, attempts: attempt };
    } catch (err: unknown) {
      lastError = err as ScraperError;

      // 404 = product definitively removed, do not retry
      if (err instanceof HttpError && err.status === 404) {
        logger.warn("withRetry: 404 not retrying (product removed)", {
          status: 404,
          attempt,
        });
        throw err;
      }

      if (!shouldRetry(err) || attempt === totalAttempts) {
        opts.onAttemptFailed?.(attempt, lastError);
        throw lastError;
      }

      opts.onAttemptFailed?.(attempt, lastError);

      // Respect Retry-After if present in HttpError message (encoded as JSON)
      let delayMs: number;
      if (err instanceof HttpError && err.status === 429) {
        try {
          const parsed = JSON.parse(err.message);
          delayMs = parsed.retryAfterMs ?? jitter(Math.min(capDelayMs, baseDelayMs * 2 ** (attempt - 1)));
        } catch {
          delayMs = jitter(Math.min(capDelayMs, baseDelayMs * 2 ** (attempt - 1)));
        }
      } else {
        // Exponential backoff with jitter: base * 2^(attempt-1), capped
        delayMs = jitter(Math.min(capDelayMs, baseDelayMs * 2 ** (attempt - 1)));
      }

      logger.info(`withRetry: attempt ${attempt} failed, retrying in ${Math.round(delayMs)}ms`, {
        attempt,
        nextAttempt: attempt + 1,
        delayMs: Math.round(delayMs),
        error: err instanceof Error ? err.message : String(err),
      });

      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  throw lastError;
}
