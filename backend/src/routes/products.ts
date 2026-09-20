// backend/src/routes/products.ts
// CRUD routes for tracked products + per-product history/logs.

import { Router } from "express";
import { z } from "zod";
import {
  listProducts,
  getProduct,
  upsertProduct,
  deleteProduct,
  getProductStats,
} from "../db/products.js";
import { getPriceHistory, getScrapeLogs } from "../db/history.js";
import { fetchProductMeta } from "../scraper/catalog.js";
import { scrapeSingleProduct } from "../scraper/orchestrator.js";
import { getEnv } from "../lib/env.js";
import { logger } from "../lib/logger.js";

export const productsRouter = Router();

// ── GET /api/products — list all tracked products ─────────────────────────────
productsRouter.get("/", async (_req, res) => {
  try {
    const products = await listProducts();
    res.json({ products });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "DB error" });
  }
});

// ── POST /api/products — track a new product ──────────────────────────────────
const trackSchema = z.object({
  store_product_id: z.string().min(1).max(20),
});

productsRouter.post("/", async (req, res) => {
  const parse = trackSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "store_product_id required" });
    return;
  }

  const { store_product_id } = parse.data;
  const env = getEnv();

  try {
    // Fetch metadata from the store API
    const meta = await fetchProductMeta(store_product_id);
    if (!meta) {
      res.status(404).json({ error: `Product ${store_product_id} not found in store` });
      return;
    }

    const product = await upsertProduct({
      store_product_id,
      name: meta.name,
      url: `${env.STORE_BASE_URL}/product/${meta.slug}`,
      image_url: null,
      category: meta.category,
      brand: meta.brand,
      sku: meta.sku,
      description: meta.description,
    });

    // Trigger an initial scrape in the background after 2 seconds
    setTimeout(() => {
      scrapeSingleProduct(product, "manual").catch((err) => {
        logger.error("Background initial scrape failed", {
          productId: product.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, 2000);

    res.status(201).json({ product });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to track product";
    logger.error("Track product error", { error: msg, store_product_id });
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/products/:id — product detail + summary stats ────────────────────
productsRouter.get("/:id", async (req, res) => {
  try {
    const product = await getProduct(req.params.id);
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const stats = await getProductStats(product.id);
    res.json({ product, stats });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "DB error" });
  }
});

// ── GET /api/products/:id/history — price/stock time series ──────────────────
productsRouter.get("/:id/history", async (req, res) => {
  const limit = Math.min(500, parseInt(String(req.query.limit ?? "100"), 10) || 100);

  try {
    const product = await getProduct(req.params.id);
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const history = await getPriceHistory(product.id, limit);
    res.json({ history });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "DB error" });
  }
});

// ── GET /api/products/:id/logs — scrape attempt logs ─────────────────────────
productsRouter.get("/:id/logs", async (req, res) => {
  const limit = Math.min(200, parseInt(String(req.query.limit ?? "50"), 10) || 50);

  try {
    const product = await getProduct(req.params.id);
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const logs = await getScrapeLogs(product.id, limit);
    res.json({ logs });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "DB error" });
  }
});

// ── DELETE /api/products/:id — untrack a product ─────────────────────────────
productsRouter.delete("/:id", async (req, res) => {
  try {
    const deleted = await deleteProduct(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "DB error" });
  }
});

// ── POST /api/products/:id/scrape — manual scrape ────────────────────────────
productsRouter.post("/:id/scrape", async (req, res) => {
  try {
    const product = await getProduct(req.params.id);
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    // Respond immediately, run scrape in background
    res.status(202).json({ message: "Scrape started", productId: product.id });

    setImmediate(() => {
      scrapeSingleProduct(product, "manual").catch((err) => {
        logger.error("Manual scrape failed", {
          productId: product.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "DB error" });
  }
});

// ─── Helper: constant-time string comparison ──────────────────────────────────
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still scan both to avoid length-based timing
    let diff = a.length ^ b.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      diff |= (a.charCodeAt(i) ?? 0) ^ (b.charCodeAt(i) ?? 0);
    }
    return diff === 0;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
