import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  const { getPool } = await import('../../src/db/pool.js');
  const { buildApp } = await import('../../src/app.js');
  app = buildApp(await getPool());
});

describe('public catalog API', () => {
  it('GET /api/health responds', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('lists active products with shade swatches and price ranges', async () => {
    const res = await request(app).get('/api/products?limit=60');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(16);
    const oil = res.body.products.find((p: { slug: string }) => p.slug === 'high-shine-lip-oil');
    expect(oil).toBeDefined();
    expect(oil.swatches.length).toBe(5);
    expect(oil.swatches[0].hexColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(oil.priceCents).toBe(2200);
    expect(oil.inStock).toBe(true);
  });

  it('filters by category including children (lips covers both subcategories)', async () => {
    const res = await request(app).get('/api/products?category=lips&limit=60');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(12);
  });

  it('serves product detail with variants and lowercase hexes', async () => {
    const res = await request(app).get('/api/products/creamy-matte-lipstick');
    expect(res.status).toBe(200);
    const p = res.body.product;
    expect(p.variants.length).toBe(5);
    for (const v of p.variants) {
      if (v.hexColor) expect(v.hexColor).toBe(v.hexColor.toLowerCase());
      expect(v.priceCents).toBe(2400);
      expect(v).not.toHaveProperty('stockQuantity'); // stock is never public
    }
  });

  it('404s unknown product slugs', async () => {
    const res = await request(app).get('/api/products/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns the category tree with counts', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    const lips = res.body.categories.find((c: { slug: string }) => c.slug === 'lips');
    expect(lips.children.map((c: { slug: string }) => c.slug).sort()).toEqual([
      'lip-color',
      'lip-oil',
    ]);
    expect(lips.productCount).toBe(12);
  });

  it('recommends same-finish neighbours first for a matte lipstick', async () => {
    const res = await request(app).get('/api/products/creamy-matte-lipstick/related');
    expect(res.status).toBe(200);
    const names = res.body.products.map((p: { name: string }) => p.name);
    // The two other mattes must outrank everything else.
    expect(names.slice(0, 2).sort()).toEqual([
      'Long-Lasting Matte Liquid Lipstick',
      'Matte Lip Liner',
    ]);
  });

  it('marks catalog responses publicly cacheable', async () => {
    const res = await request(app).get('/api/products');
    expect(res.headers['cache-control']).toContain('public');
  });
});
