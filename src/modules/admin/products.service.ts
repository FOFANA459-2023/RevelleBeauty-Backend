import type { Pool } from 'pg';
import type { z } from 'zod';
import type {
  AdminProductDetailDTO,
  AdminProductSummaryDTO,
  AdminVariantDTO,
  ImageDTO,
} from '@contracts/index';
import { conflict, notFound } from '../../lib/errors.js';
import { ensureUniqueSlug, slugify } from '../../lib/slug.js';
import { storage } from '../../lib/storage.js';
import type {
  productPatchSchema,
  productUpsertSchema,
  variantUpsertSchema,
} from './admin.schemas.js';

type ProductUpsert = z.infer<typeof productUpsertSchema>;
type ProductPatch = z.infer<typeof productPatchSchema>;
type VariantUpsert = z.infer<typeof variantUpsertSchema>;

/* ---------- list / detail ---------- */

export async function listAdminProducts(
  pool: Pool,
  q: { status?: string; category?: string; q?: string; limit?: number; offset?: number },
): Promise<{ products: AdminProductSummaryDTO[]; total: number }> {
  const where: string[] = ['true'];
  const params: unknown[] = [];

  if (q.status) {
    params.push(q.status);
    where.push(`p.status = $${params.length}::product_status`);
  }
  if (q.category) {
    params.push(q.category);
    where.push(`c.slug = $${params.length}`);
  }
  if (q.q) {
    params.push(`%${q.q}%`);
    where.push(`p.name ilike $${params.length}`);
  }

  const { rows: countRows } = await pool.query<{ count: string }>(
    `select count(*) from products p join categories c on c.id = p.category_id
      where ${where.join(' and ')}`,
    params,
  );

  const limit = Math.min(q.limit ?? 50, 100);
  const offset = q.offset ?? 0;
  params.push(limit, offset);

  const { rows } = await pool.query(
    `select p.id, p.slug, p.name, p.category_id, c.name as category_name,
            p.status::text as status, p.base_price_cents, p.is_featured, p.display_order,
            p.updated_at,
            (select count(*) from product_variants v where v.product_id = p.id)::int as variant_count,
            (select coalesce(sum(v.stock_quantity), 0) from product_variants v where v.product_id = p.id)::int as total_stock,
            (select i.storage_path from product_images i where i.product_id = p.id
              order by i.is_primary desc, i.display_order limit 1) as primary_image_path
       from products p
       join categories c on c.id = p.category_id
      where ${where.join(' and ')}
      order by c.name, p.display_order, p.name
      limit $${params.length - 1} offset $${params.length}`,
    params,
  );

  return {
    total: Number(countRows[0]?.count ?? 0),
    products: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      categoryId: r.category_id,
      categoryName: r.category_name,
      status: r.status,
      basePriceCents: r.base_price_cents,
      isFeatured: r.is_featured,
      displayOrder: r.display_order,
      variantCount: r.variant_count,
      totalStock: r.total_stock,
      primaryImageUrl: r.primary_image_path ? storage.publicUrl(r.primary_image_path) : null,
      updatedAt: r.updated_at,
    })),
  };
}

export async function getAdminProduct(pool: Pool, id: string): Promise<AdminProductDetailDTO> {
  const { rows } = await pool.query(`select * from products where id = $1`, [id]);
  const p = rows[0];
  if (!p) throw notFound('Product not found');

  const { rows: variants } = await pool.query(
    `select v.*,
            exists(select 1 from order_items oi where oi.variant_id = v.id) as has_orders
       from product_variants v where v.product_id = $1 order by v.display_order`,
    [id],
  );
  const { rows: images } = await pool.query(
    `select * from product_images where product_id = $1 order by display_order`,
    [id],
  );

  return {
    id: p.id,
    categoryId: p.category_id,
    slug: p.slug,
    name: p.name,
    tagline: p.tagline,
    description: p.description,
    ingredients: p.ingredients,
    howToUse: p.how_to_use,
    basePriceCents: p.base_price_cents,
    compareAtPriceCents: p.compare_at_price_cents,
    sku: p.sku,
    status: p.status,
    trackInventory: p.track_inventory,
    variantLabel: p.variant_label,
    isFeatured: p.is_featured,
    displayOrder: p.display_order,
    metaTitle: p.meta_title,
    metaDescription: p.meta_description,
    variants: variants.map(mapAdminVariant(p.base_price_cents)),
    images: images.map(mapAdminImage),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

function mapAdminVariant(basePriceCents: number) {
  return (v: Record<string, unknown>): AdminVariantDTO => ({
    id: v.id as string,
    productId: v.product_id as string,
    name: v.name as string,
    slug: v.slug as string,
    hexColor: v.hex_color as string | null,
    hexColorSecondary: v.hex_color_secondary as string | null,
    finish: v.finish as string | null,
    sku: v.sku as string | null,
    priceCentsOverride: v.price_cents_override as number | null,
    effectivePriceCents: (v.price_cents_override as number | null) ?? basePriceCents,
    stockQuantity: v.stock_quantity as number,
    isAvailable: v.is_available as boolean,
    isDefault: v.is_default as boolean,
    displayOrder: v.display_order as number,
    hasOrders: Boolean(v.has_orders),
  });
}

function mapAdminImage(i: Record<string, unknown>): ImageDTO {
  return {
    id: i.id as string,
    url: storage.publicUrl(i.storage_path as string),
    altText: i.alt_text as string | null,
    width: i.width as number | null,
    height: i.height as number | null,
    isPrimary: i.is_primary as boolean,
    variantId: i.variant_id as string | null,
    displayOrder: i.display_order as number,
  };
}

/* ---------- create / update ---------- */

export async function createProduct(pool: Pool, input: ProductUpsert): Promise<AdminProductDetailDTO> {
  const slug = input.slug ?? (await ensureUniqueSlug(pool, 'products', input.name));
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<{ id: string }>(
      `insert into products
         (category_id, slug, name, tagline, description, ingredients, how_to_use,
          base_price_cents, compare_at_price_cents, sku, status, track_inventory,
          variant_label, is_featured, display_order, meta_title, meta_description, published_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::product_status,$12,$13,$14,$15,$16,$17,
               case when $11 = 'active' then now() else null end)
       returning id`,
      [
        input.categoryId, slug, input.name, input.tagline ?? null, input.description ?? null,
        input.ingredients ?? null, input.howToUse ?? null, input.basePriceCents,
        input.compareAtPriceCents ?? null, input.sku ?? null, input.status ?? 'draft',
        input.trackInventory ?? true, input.variantLabel ?? 'Shade',
        input.isFeatured ?? false, input.displayOrder ?? 0,
        input.metaTitle ?? null, input.metaDescription ?? null,
      ],
    );
    const productId = rows[0]!.id;

    const variants = input.variants?.length
      ? input.variants
      : [{ name: 'Default', isDefault: true } as VariantUpsert];

    let order = 1;
    for (const v of variants) {
      await insertVariant(client, productId, v, order++);
    }
    await client.query('commit');
    return getAdminProduct(pool, productId);
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function insertVariant(
  client: { query: Pool['query'] },
  productId: string,
  v: VariantUpsert,
  fallbackOrder: number,
): Promise<string> {
  const vslug = slugify(v.name) || `variant-${fallbackOrder}`;
  const { rows } = await client.query<{ id: string }>(
    `insert into product_variants
       (product_id, name, slug, hex_color, hex_color_secondary, finish, sku,
        price_cents_override, stock_quantity, is_available, is_default, display_order)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning id`,
    [
      productId, v.name, vslug, v.hexColor ?? null, v.hexColorSecondary ?? null,
      v.finish ?? null, v.sku ?? null, v.priceCentsOverride ?? null,
      v.stockQuantity ?? 0, v.isAvailable ?? true, v.isDefault ?? false,
      v.displayOrder ?? fallbackOrder,
    ],
  );
  return rows[0]!.id;
}

export async function updateProduct(
  pool: Pool,
  id: string,
  patch: ProductPatch,
): Promise<AdminProductDetailDTO> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };

  if (patch.categoryId !== undefined) push('category_id', patch.categoryId);
  if (patch.name !== undefined) push('name', patch.name);
  if (patch.slug !== undefined) push('slug', patch.slug);
  if (patch.tagline !== undefined) push('tagline', patch.tagline);
  if (patch.description !== undefined) push('description', patch.description);
  if (patch.ingredients !== undefined) push('ingredients', patch.ingredients);
  if (patch.howToUse !== undefined) push('how_to_use', patch.howToUse);
  if (patch.basePriceCents !== undefined) push('base_price_cents', patch.basePriceCents);
  if (patch.compareAtPriceCents !== undefined) push('compare_at_price_cents', patch.compareAtPriceCents);
  if (patch.sku !== undefined) push('sku', patch.sku);
  if (patch.trackInventory !== undefined) push('track_inventory', patch.trackInventory);
  if (patch.variantLabel !== undefined) push('variant_label', patch.variantLabel);
  if (patch.isFeatured !== undefined) push('is_featured', patch.isFeatured);
  if (patch.displayOrder !== undefined) push('display_order', patch.displayOrder);
  if (patch.metaTitle !== undefined) push('meta_title', patch.metaTitle);
  if (patch.metaDescription !== undefined) push('meta_description', patch.metaDescription);
  if (patch.status !== undefined) {
    params.push(patch.status);
    sets.push(`status = $${params.length}::product_status`);
    sets.push(`published_at = case when $${params.length} = 'active' and published_at is null then now() else published_at end`);
  }

  if (sets.length > 0) {
    params.push(id);
    const result = await pool.query(
      `update products set ${sets.join(', ')} where id = $${params.length}`,
      params,
    );
    if (result.rowCount === 0) throw notFound('Product not found');
  }
  return getAdminProduct(pool, id);
}

/** DELETE archives — never hard-deletes (order history references products). */
export async function archiveProduct(pool: Pool, id: string): Promise<void> {
  const result = await pool.query(
    `update products set status = 'archived' where id = $1`,
    [id],
  );
  if (result.rowCount === 0) throw notFound('Product not found');
}

/* ---------- variants ---------- */

export async function createVariant(
  pool: Pool,
  productId: string,
  input: VariantUpsert,
): Promise<AdminProductDetailDTO> {
  const { rows } = await pool.query(`select id from products where id = $1`, [productId]);
  if (!rows[0]) throw notFound('Product not found');

  if (input.isDefault) {
    await pool.query(
      `update product_variants set is_default = false where product_id = $1`,
      [productId],
    );
  }
  await insertVariant(pool, productId, input, 999);
  return getAdminProduct(pool, productId);
}

export async function updateVariant(
  pool: Pool,
  variantId: string,
  patch: Partial<VariantUpsert>,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };

  if (patch.name !== undefined) {
    push('name', patch.name);
    push('slug', slugify(patch.name));
  }
  if (patch.hexColor !== undefined) push('hex_color', patch.hexColor);
  if (patch.hexColorSecondary !== undefined) push('hex_color_secondary', patch.hexColorSecondary);
  if (patch.finish !== undefined) push('finish', patch.finish);
  if (patch.sku !== undefined) push('sku', patch.sku);
  if (patch.priceCentsOverride !== undefined) push('price_cents_override', patch.priceCentsOverride);
  if (patch.stockQuantity !== undefined) push('stock_quantity', patch.stockQuantity);
  if (patch.isAvailable !== undefined) push('is_available', patch.isAvailable);
  if (patch.displayOrder !== undefined) push('display_order', patch.displayOrder);

  if (patch.isDefault === true) {
    await pool.query(
      `update product_variants set is_default = false
        where product_id = (select product_id from product_variants where id = $1)`,
      [variantId],
    );
    push('is_default', true);
  }

  if (sets.length === 0) return;
  params.push(variantId);
  const result = await pool.query(
    `update product_variants set ${sets.join(', ')} where id = $${params.length}`,
    params,
  );
  if (result.rowCount === 0) throw notFound('Variant not found');
}

export async function adjustStock(
  pool: Pool,
  variantId: string,
  input: { stockQuantity?: number; isAvailable?: boolean; note?: string },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<{ stock_quantity: number }>(
      `select stock_quantity from product_variants where id = $1 for update`,
      [variantId],
    );
    if (!rows[0]) throw notFound('Variant not found');

    if (input.stockQuantity !== undefined && input.stockQuantity !== rows[0].stock_quantity) {
      const delta = input.stockQuantity - rows[0].stock_quantity;
      await client.query(
        `update product_variants set stock_quantity = $1 where id = $2`,
        [input.stockQuantity, variantId],
      );
      await client.query(
        `insert into inventory_adjustments (variant_id, delta, reason, note)
         values ($1, $2, 'manual', $3)`,
        [variantId, delta, input.note ?? null],
      );
    }
    if (input.isAvailable !== undefined) {
      await client.query(
        `update product_variants set is_available = $1 where id = $2`,
        [input.isAvailable, variantId],
      );
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteVariant(pool: Pool, variantId: string): Promise<void> {
  const { rows } = await pool.query<{ product_id: string; has_orders: boolean; cnt: string }>(
    `select v.product_id,
            exists(select 1 from order_items oi where oi.variant_id = v.id) as has_orders,
            (select count(*) from product_variants where product_id = v.product_id) as cnt
       from product_variants v where v.id = $1`,
    [variantId],
  );
  const v = rows[0];
  if (!v) throw notFound('Variant not found');
  if (Number(v.cnt) <= 1) throw conflict('A product must retain at least one variant');
  if (v.has_orders) {
    // Sold at least once: archive (hide) instead of hard delete.
    await pool.query(
      `update product_variants set is_available = false where id = $1`,
      [variantId],
    );
    return;
  }
  await pool.query(`delete from product_variants where id = $1`, [variantId]);
}

export async function reorder(
  pool: Pool,
  table: 'products' | 'product_variants' | 'categories' | 'product_images',
  items: { id: string; displayOrder: number }[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const item of items) {
      await client.query(`update ${table} set display_order = $1 where id = $2`, [
        item.displayOrder, item.id,
      ]);
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
