import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';

let app: Express;
let pool: Pool;

beforeAll(async () => {
  const { getPool } = await import('../../src/db/pool.js');
  const { buildApp } = await import('../../src/app.js');
  pool = await getPool();
  app = buildApp(pool);
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
    // Four photographed shades (migration 0012); the swatch row is ordered
    // by the maker's shade code.
    expect(oil.swatches.length).toBe(4);
    expect(oil.swatches.map((s: { shadeCode: string }) => s.shadeCode)).toEqual([
      'HS01', 'HS02', 'HS04', 'HS06',
    ]);
    expect(oil.swatches[0].hexColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(oil.priceCents).toBe(1499);
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
    expect(p.variants.length).toBe(4);
    for (const v of p.variants) {
      if (v.hexColor) expect(v.hexColor).toBe(v.hexColor.toLowerCase());
      // Code leads the slug, so ?shade= stays unique even when two products
      // both sell a "Crystal Clear".
      expect(v.slug.startsWith(`${v.shadeCode.toLowerCase()}-`)).toBe(true);
      expect(v.priceCents).toBe(1499);
      expect(v).not.toHaveProperty('stockQuantity'); // stock is never public
    }
  });

  it('gives each shade its own first photograph, for previews in the grid', async () => {
    // Seeded migrations carry no photography, so stage one shot on one shade.
    const { rows: [variant] } = await pool.query<{ id: string; product_id: string }>(
      `select v.id, v.product_id from product_variants v
         join products p on p.id = v.product_id
        where p.slug = 'high-shine-lip-oil' order by v.display_order limit 1`,
    );
    const storagePath = `products/${variant!.product_id}/test-preview.webp`;
    await pool.query(
      `insert into product_images (product_id, variant_id, storage_path, display_order)
       values ($1,$2,$3,99) on conflict (storage_path) do nothing`,
      [variant!.product_id, variant!.id, storagePath],
    );
    // The catalog is cached in memory; an earlier request in this file has
    // already warmed it, exactly as an admin edit would find it.
    const { invalidateCatalog } = await import('../../src/lib/cache.js');
    invalidateCatalog();
    try {
      const res = await request(app).get('/api/products?limit=60');
      const oil = res.body.products.find((p: { slug: string }) => p.slug === 'high-shine-lip-oil');
      const shade = oil.swatches.find((s: { id: string }) => s.id === variant!.id);
      expect(shade.imageUrls).toHaveLength(1);
      expect(shade.imageUrls[0]).toContain('test-preview.webp');
      // Shades without photography carry none rather than borrowing another's.
      const others = oil.swatches.filter((s: { id: string }) => s.id !== variant!.id);
      expect(others.every((s: { imageUrls: string[] }) => s.imageUrls.length === 0)).toBe(true);
    } finally {
      await pool.query(`delete from product_images where storage_path = $1`, [storagePath]);
      invalidateCatalog();
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
