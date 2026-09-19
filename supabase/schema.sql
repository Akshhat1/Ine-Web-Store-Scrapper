-- INE Price Tracker — Supabase Schema
-- Run this once in the Supabase SQL editor.
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE patterns).

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- tracked_products
-- One row per product the user has chosen to track.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tracked_products (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_product_id TEXT        NOT NULL UNIQUE,   -- e.g. "852"
  name             TEXT        NOT NULL,
  url              TEXT        NOT NULL,           -- full product page URL
  image_url        TEXT,                           -- null — store has no image API
  category         TEXT,
  brand            TEXT,
  sku              TEXT,
  description      TEXT,
  last_price       NUMERIC,
  last_stock       TEXT,
  last_scraped_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- scrape_runs
-- One row per batch scrape triggered by cron or manually.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scrape_runs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger          TEXT        NOT NULL CHECK (trigger IN ('cron','manual','headed')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  products_total   INT         NOT NULL DEFAULT 0,
  products_ok      INT         NOT NULL DEFAULT 0,
  products_failed  INT         NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────────────────────────────────────
-- price_history
-- One row per successful scrape of a product's price/stock.
-- Only written on SUCCESS or RETRIED (never on FAILED).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_history (
  id          BIGSERIAL   PRIMARY KEY,
  product_id  UUID        NOT NULL REFERENCES tracked_products(id) ON DELETE CASCADE,
  run_id      UUID        REFERENCES scrape_runs(id) ON DELETE SET NULL,
  price       NUMERIC     NOT NULL CHECK (price > 0),
  stock       TEXT        NOT NULL CHECK (stock IN ('in_stock','out_of_stock','low_stock','unknown')),
  scraped_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast time-series queries per product
CREATE INDEX IF NOT EXISTS idx_price_history_product_time
  ON price_history (product_id, scraped_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- scrape_logs
-- One row per scrape attempt for a product.
-- Records every attempt including failures — transparency is required.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scrape_logs (
  id            BIGSERIAL   PRIMARY KEY,
  product_id    UUID        NOT NULL REFERENCES tracked_products(id) ON DELETE CASCADE,
  run_id        UUID        REFERENCES scrape_runs(id) ON DELETE SET NULL,
  attempt       INT         NOT NULL,   -- 1 = first try, 2+ = retries
  status        TEXT        NOT NULL CHECK (status IN ('SUCCESS','RETRIED','FAILED')),
  latency_ms    INT,
  http_status   INT,
  error_type    TEXT        CHECK (error_type IN (
                  'TIMEOUT','HTTP_ERROR','PARSE_ERROR','VALIDATION_ERROR',
                  'STRUCTURE_CHANGED','SUSPICIOUS_VALUE','BROWSER_ERROR','UNKNOWN'
                )),
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast recent-log queries per product
CREATE INDEX IF NOT EXISTS idx_scrape_logs_product_time
  ON scrape_logs (product_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- alerts (Bonus 3)
-- Price-drop and back-in-stock alerts.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id          BIGSERIAL   PRIMARY KEY,
  product_id  UUID        NOT NULL REFERENCES tracked_products(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL CHECK (type IN ('price_drop','back_in_stock','structure_changed')),
  old_value   TEXT,
  new_value   TEXT,
  seen        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_product
  ON alerts (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_unseen
  ON alerts (seen) WHERE seen = FALSE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security (RLS)
-- Since access is handled via the backend API using SUPABASE_SERVICE_KEY,
-- disable RLS on all tables so backend queries run cleanly.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE tracked_products DISABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE price_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE alerts DISABLE ROW LEVEL SECURITY;

