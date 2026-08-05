import { Router } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import * as svc from './products.service.js';
import {
  adminListQuerySchema,
  productPatchSchema,
  productUpsertSchema,
  reorderSchema,
  stockUpdateSchema,
  variantUpsertSchema,
} from './admin.schemas.js';

export function adminProductRoutes(pool: Pool): Router {
  const r = Router();

  r.get('/products', async (req, res) => {
    const q = adminListQuerySchema.parse(req.query);
    res.json(await svc.listAdminProducts(pool, q));
  });

  r.get('/products/:id', async (req, res) => {
    res.json({ product: await svc.getAdminProduct(pool, req.params.id) });
  });

  r.post('/products', async (req, res) => {
    const input = productUpsertSchema.parse(req.body);
    res.status(201).json({ product: await svc.createProduct(pool, input) });
  });

  r.patch('/products/:id', async (req, res) => {
    const patch = productPatchSchema.parse(req.body);
    res.json({ product: await svc.updateProduct(pool, req.params.id, patch) });
  });

  r.post('/products/:id/status', async (req, res) => {
    const { status } = z
      .object({ status: z.enum(['draft', 'active', 'archived']) })
      .strict()
      .parse(req.body);
    res.json({ product: await svc.updateProduct(pool, req.params.id, { status }) });
  });

  r.delete('/products/:id', async (req, res) => {
    await svc.archiveProduct(pool, req.params.id);
    res.status(204).end();
  });

  r.post('/products/reorder', async (req, res) => {
    const { items } = reorderSchema.parse(req.body);
    await svc.reorder(pool, 'products', items);
    res.json({ ok: true });
  });

  r.post('/products/:id/variants', async (req, res) => {
    const input = variantUpsertSchema.parse(req.body);
    res.status(201).json({ product: await svc.createVariant(pool, req.params.id, input) });
  });

  r.patch('/variants/:id', async (req, res) => {
    const patch = variantUpsertSchema.partial().strict().parse(req.body);
    await svc.updateVariant(pool, req.params.id, patch);
    res.json({ ok: true });
  });

  r.patch('/variants/:id/stock', async (req, res) => {
    const input = stockUpdateSchema.parse(req.body);
    await svc.adjustStock(pool, req.params.id, input);
    res.json({ ok: true });
  });

  r.delete('/variants/:id', async (req, res) => {
    await svc.deleteVariant(pool, req.params.id);
    res.status(204).end();
  });

  r.post('/products/:id/variants/reorder', async (req, res) => {
    const { items } = reorderSchema.parse(req.body);
    await svc.reorder(pool, 'product_variants', items);
    res.json({ ok: true });
  });

  return r;
}
