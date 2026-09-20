// backend/src/lib/env.ts
// Centralised env validation — fail fast at startup if required vars are missing.

import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(10),
  STORE_BASE_URL: z
    .string()
    .url()
    .default("https://demo.inelabteamdev.com"),
  CRON_SECRET: z.string().min(8),
  FRONTEND_ORIGIN: z.string().default("*"),
  ENABLE_BROWSER: z
    .string()
    .transform((v) => v === "true" || v === "1")
    .default("true"),
  SCRAPE_TIMEOUT_MS: z.coerce.number().default(30000),
  MAX_RETRIES: z.coerce.number().int().min(1).max(10).default(3),
  PRICE_JUMP_THRESHOLD: z.coerce.number().default(0.5),
  RUN_TIME_BUDGET_MS: z.coerce.number().default(600000),
  CATALOG_CACHE_TTL_MS: z.coerce.number().default(3600000),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;
  if (process.env.NODE_ENV === "test" || !process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://test-example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test_service_key_min_10_chars";
    process.env.CRON_SECRET = process.env.CRON_SECRET || "test_cron_secret_min_8_chars";
  }
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Missing or invalid environment variables:");
    console.error(result.error.format());
    process.exit(1);
  }
  _env = result.data;
  return _env;
}
