import { Router } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import * as svc from './catalog.service.js';
import { getRelatedProductIds } from './related.service.js';
import { cached } from '../../lib/cache.js';

const listQuerySchema = z.object({
  category: z.string().regex(/^[a-z0-9-]+$/).optional(),
  featured: z.coerce.boolean().optional(),
  q: z.string().max(120).optional(),
  sort: z.enum(['featured', 'newest', 'price_asc', 'price_desc', 'name']).optional(),
  limit: z.coerce.number().int().min(1).max(60).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const CACHE = 'public, max-age=60, stale-while-revalidate=300';

export function catalogRoutes(pool: Pool): Router {
  const r = Router();

  r.get('/categories', async (_req, res) => {
    res.set('Cache-Control', CACHE);
    res.json({ categories: await svc.listCategories(pool) });
  });

  r.get('/categories/:slug', async (req, res) => {
    res.set('Cache-Control', CACHE);
    res.json({ category: await svc.getCategoryBySlug(pool, req.params.slug) });
  });

  r.get('/products', async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    res.set('Cache-Control', CACHE);
    res.json(await svc.listProducts(pool, q));
  });

  r.get('/products/:slug', async (req, res) => {
    res.set('Cache-Control', CACHE);
    res.json({ product: await svc.getProductBySlug(pool, req.params.slug) });
  });

  r.get('/products/:slug/related', async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(12).default(4).parse(req.query.limit);
    const payload = await cached(
      `catalog:related:${req.params.slug}:${limit}`,
      2 * 60_000,
      async () => {
        const scored = await getRelatedProductIds(pool, req.params.slug, limit);
        const products = await svc.getProductSummariesByIds(
          pool,
          scored.map((s) => s.productId),
        );
        // score + human-readable reasons ride along for UI badges/debugging
        return { products, meta: scored };
      },
    );
    res.set('Cache-Control', CACHE);
    res.json(payload);
  });

  r.get('/settings', async (_req, res) => {
    res.set('Cache-Control', CACHE);
    res.json(await svc.getSettings(pool));
  });

  return r;
}
