// backend/src/routes/cron.ts
// POST /api/cron/scrape-all — authenticated endpoint called by cron-job.org.
// Responds 202 immediately and runs the batch in the background.
// GET  /api/runs — recent run history.

import { Router } from "express";
import { getEnv } from "../lib/env.js";
import { runBatchScrape } from "../scraper/orchestrator.js";
import { getRecentRuns } from "../db/history.js";
import { logger } from "../lib/logger.js";

export const cronRouter = Router();

// Constant-time compare to prevent timing side-channel attacks
function timingSafeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (a.charCodeAt(i) ?? 0) ^ (b.charCodeAt(i) ?? 0);
  }
  return diff === 0;
}

function requireCronSecret(req: import("express").Request, res: import("express").Response): boolean {
  const env = getEnv();
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!timingSafeEqual(token, env.CRON_SECRET)) {
    res.status(401).json({ error: "Unauthorized — invalid CRON_SECRET" });
    return false;
  }
  return true;
}

// ── POST /api/cron/scrape-all ─────────────────────────────────────────────────
// cron-job.org times out at ~30s; we respond 202 immediately and run in bg.
cronRouter.post("/scrape-all", async (req, res) => {
  if (!requireCronSecret(req, res)) return;

  // Respond immediately — cron-job.org will time out otherwise
  res.status(202).json({ message: "Batch scrape queued" });

  // Run in background (do NOT await here — response already sent)
  setImmediate(() => {
    runBatchScrape("cron").catch((err) => {
      logger.error("Background batch scrape crashed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
});

// ── GET /api/runs ─────────────────────────────────────────────────────────────
cronRouter.get("/runs", async (_req, res) => {
  try {
    const runs = await getRecentRuns(20);
    res.json({ runs });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "DB error" });
  }
});
