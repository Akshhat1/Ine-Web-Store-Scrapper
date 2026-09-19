// backend/src/routes/store.ts
// GET /api/store/search?q= — live search the store catalog.

import { Router } from "express";
import { z } from "zod";
import { searchStore } from "../scraper/catalog.js";
import { logger } from "../lib/logger.js";

export const storeRouter = Router();

const searchSchema = z.object({
  q: z.string().min(2).max(100),
});

storeRouter.get("/search", async (req, res) => {
  const parse = searchSchema.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: "Query param 'q' required (min 2 chars)" });
    return;
  }

  try {
    const results = await searchStore(parse.data.q);
    res.json({ results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Search failed";
    logger.error("Store search error", { error: msg });
    res.status(502).json({ error: msg });
  }
});
