// backend/src/server.ts
// Express application entry point.

import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { getEnv } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { storeRouter } from "./routes/store.js";
import { productsRouter } from "./routes/products.js";
import { cronRouter } from "./routes/cron.js";
import { getUnseenAlerts } from "./db/history.js";

// Validate env at startup — exits with error message if anything is missing
const env = getEnv();

const app = express();

// ── Security middleware ────────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: env.FRONTEND_ORIGIN,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json());

// ── Rate limiting (public routes only) ───────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,     // 1 minute window
  max: 60,                  // 60 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please slow down" },
});
app.use("/api/store", limiter);

// ── Health check (no DB, no auth, for keep-warm cron) ────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use("/api/store", storeRouter);
app.use("/api/products", productsRouter);
app.use("/api/cron", cronRouter);
app.get("/api/runs", async (_req, res) => {
  // Convenience alias — forward to cron router
  try {
    const { getRecentRuns } = await import("./db/history.js");
    const runs = await getRecentRuns(20);
    res.json({ runs });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "DB error" });
  }
});

// ── Alerts endpoint (Bonus 3) ─────────────────────────────────────────────────
app.get("/api/alerts", async (_req, res) => {
  try {
    const alerts = await getUnseenAlerts();
    res.json({ alerts });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "DB error" });
  }
});

app.post("/api/alerts/mark-seen", async (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids)) {
    res.status(400).json({ error: "ids array required" });
    return;
  }
  try {
    const { markAlertsSeen } = await import("./db/history.js");
    await markAlertsSeen(ids);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "DB error" });
  }
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logger.error("Unhandled route error", { error: err.message, stack: err.stack });
    res.status(500).json({ error: "Internal server error" });
  },
);

// ── Graceful unhandled rejection handling ─────────────────────────────────────
// Never crash the process on a scrape failure
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Promise rejection (process continuing)", {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception — this should not happen in scrape code", {
    error: err.message,
    stack: err.stack,
  });
  // For truly unexpected exceptions (not scrape failures), restart is safer
  process.exit(1);
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(env.PORT, () => {
  logger.info(`Server listening`, {
    port: env.PORT,
    frontendOrigin: env.FRONTEND_ORIGIN,
    enableBrowser: env.ENABLE_BROWSER,
    nodeEnv: process.env.NODE_ENV ?? "development",
  });
});
