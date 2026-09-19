// backend/src/lib/logger.ts
// Structured JSON logger — structured logging helps grep/filter in production.

type Level = "debug" | "info" | "warn" | "error";

interface LogEntry {
  ts: string;
  level: Level;
  msg: string;
  [key: string]: unknown;
}

function log(level: Level, msg: string, extra: Record<string, unknown> = {}) {
  const entry: LogEntry = { ts: new Date().toISOString(), level, msg, ...extra };
  const output = JSON.stringify(entry);
  if (level === "error" || level === "warn") {
    console.error(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  debug: (msg: string, extra?: Record<string, unknown>) =>
    log("debug", msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) =>
    log("info", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) =>
    log("warn", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) =>
    log("error", msg, extra),
};
