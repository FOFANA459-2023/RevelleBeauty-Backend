import { Router } from 'express';
import type { Pool } from 'pg';
import { conflict, notFound } from '../../lib/errors.js';
import { ensureUniqueSlug } from '../../lib/slug.js';
import { categoryUpsertSchema, reorderSchema } from './admin.schemas.js';
import { reorder } from './products.service.js';

export function adminCategoryRoutes(pool: Pool): Router {
  const r = Router();

  r.get('/categories', async (_req, res) => {
    const { rows } = await pool.query(`
      select c.*, (select count(*) from products p where p.category_id = c.id)::int as product_count
        from categories c order by c.parent_id nulls first, c.display_order, c.name
    `);
    res.json({
      categories: rows.map((c) => ({
        id: c.id,
        parentId: c.parent_id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        displayOrder: c.display_order,
        isActive: c.is_active,
        productCount: c.product_count,
      })),
    });
  });

  r.post('/categories', async (req, res) => {
    const input = categoryUpsertSchema.parse(req.body);
    const slug = input.slug ?? (await ensureUniqueSlug(pool, 'categories', input.name));
    const { rows } = await pool.query(
      `insert into categories (name, parent_id, slug, description, display_order, is_active)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [
        input.name, input.parentId ?? null, slug, input.description ?? null,
        input.displayOrder ?? 0, input.isActive ?? true,
      ],
    );
    res.status(201).json({ ok: true, id: rows[0]!.id });
  });

  r.patch('/categories/:id', async (req, res) => {
    const patch = categoryUpsertSchema.partial().strict().parse(req.body);
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (patch.name !== undefined) push('name', patch.name);
    if (patch.parentId !== undefined) push('parent_id', patch.parentId);
    if (patch.slug !== undefined) push('slug', patch.slug);
    if (patch.description !== undefined) push('description', patch.description);
    if (patch.displayOrder !== undefined) push('display_order', patch.displayOrder);
    if (patch.isActive !== undefined) push('is_active', patch.isActive);
    if (sets.length) {
      params.push(req.params.id);
      const result = await pool.query(
        `update categories set ${sets.join(', ')} where id = $${params.length}`,
        params,
      );
      if (result.rowCount === 0) throw notFound('Category not found');
    }
    res.json({ ok: true });
  });

  r.delete('/categories/:id', async (req, res) => {
    const { rows } = await pool.query<{ products: string; children: string }>(
      `select (select count(*) from products where category_id = $1) as products,
              (select count(*) from categories where parent_id = $1) as children`,
      [req.params.id],
    );
    if (Number(rows[0]!.products) > 0) throw conflict('Category still has products');
    if (Number(rows[0]!.children) > 0) throw conflict('Category still has subcategories');
    const result = await pool.query(`delete from categories where id = $1`, [req.params.id]);
    if (result.rowCount === 0) throw notFound('Category not found');
    res.status(204).end();
  });

  r.post('/categories/reorder', async (req, res) => {
    const { items } = reorderSchema.parse(req.body);
    await reorder(pool, 'categories', items);
    res.json({ ok: true });
  });

  return r;
}
