import type { Pool } from 'pg';
import type {
  CategoryDTO,
  ImageDTO,
  ProductDetailDTO,
  ProductListQuery,
  ProductListResponse,
  ProductSummaryDTO,
  StoreSettingsDTO,
  SwatchDTO,
  VariantDTO,
} from '@contracts/index';
import { storage } from '../../lib/storage.js';
import { notFound } from '../../lib/errors.js';
import { cached } from '../../lib/cache.js';

/**
 * PERFORMANCE DESIGN (the DB is a remote Supabase — every round trip costs
 * real network latency):
 *  1. Each endpoint is exactly ONE SQL round trip — variants and images
 *     arrive as JSON aggregates, totals via count(*) over().
 *  2. Results are cached in-memory (lib/cache.ts) under catalog:* keys.
 *     Catalog data is public by definition; nothing personal lives here.
 *  3. Admin writes and paid orders call invalidateCatalog().
 */

const TTL = 120_000; // 2 min — TTL backstop; explicit invalidation is primary

/* ---------- row JSON shapes ---------- */

interface VariantJson {
  id: string;
  name: string;
  slug: string;
  hex_color: string | null;
  hex_color_secondary: string | null;
  finish: string | null;
  price_cents_override: number | null;
  is_default: boolean;
  display_order: number;
  in_stock: boolean;
}

interface ImageJson {
  id: string;
  variant_id: string | null;
  storage_path: string;
  alt_text: string | null;
  width: number | null;
  height: number | null;
  is_primary: boolean;
  display_order: number;
}

interface ProductRow {
  id: string;
  category_id: string;
  category_slug: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  ingredients: string | null;
  how_to_use: string | null;
  base_price_cents: number;
  compare_at_price_cents: number | null;
  variant_label: string;
  is_featured: boolean;
  meta_title: string | null;
  meta_description: string | null;
  variants_json: VariantJson[];
  images_json: ImageJson[];
  total?: string;
}

/** The single product select used by list, detail, and by-ids. */
const PRODUCT_SELECT = `
  select p.id, p.category_id, c.slug as category_slug, p.slug, p.name, p.tagline,
         p.description, p.ingredients, p.how_to_use,
         p.base_price_cents, p.compare_at_price_cents,
         p.variant_label, p.is_featured, p.meta_title, p.meta_description,
         coalesce((
           select json_agg(json_build_object(
             'id', v.id, 'name', v.name, 'slug', v.slug,
             'hex_color', v.hex_color, 'hex_color_secondary', v.hex_color_secondary,
             'finish', v.finish, 'price_cents_override', v.price_cents_override,
             'is_default', v.is_default, 'display_order', v.display_order,
             'in_stock', (v.is_available and (not p.track_inventory or v.stock_quantity > 0))
           ) order by v.display_order)
           from product_variants v where v.product_id = p.id
         ), '[]'::json) as variants_json,
         coalesce((
           select json_agg(json_build_object(
             'id', i.id, 'variant_id', i.variant_id, 'storage_path', i.storage_path,
             'alt_text', i.alt_text, 'width', i.width, 'height', i.height,
             'is_primary', i.is_primary, 'display_order', i.display_order
           ) order by i.display_order)
           from product_images i where i.product_id = p.id
         ), '[]'::json) as images_json
    from products p
    join categories c on c.id = p.category_id
`;

/* ---------- mapping ---------- */

function mapImage(i: ImageJson): ImageDTO {
  return {
    id: i.id,
    url: storage.publicUrl(i.storage_path),
    altText: i.alt_text,
    width: i.width,
    height: i.height,
    isPrimary: i.is_primary,
    variantId: i.variant_id,
    displayOrder: i.display_order,
  };
}

function toSummary(r: ProductRow): ProductSummaryDTO {
  const prices = r.variants_json.map((v) => v.price_cents_override ?? r.base_price_cents);
  const primary = r.images_json.find((i) => i.is_primary) ?? r.images_json[0];
  const swatches: SwatchDTO[] = r.variants_json
    .filter((v) => v.hex_color)
    .map((v) => ({
      id: v.id,
      name: v.name,
      slug: v.slug,
      hexColor: v.hex_color,
      hexColorSecondary: v.hex_color_secondary,
    }));

  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    tagline: r.tagline,
    categoryId: r.category_id,
    categorySlug: r.category_slug,
    priceCents: prices.length ? Math.min(...prices) : r.base_price_cents,
    priceMaxCents: prices.length ? Math.max(...prices) : r.base_price_cents,
    compareAtPriceCents: r.compare_at_price_cents,
    isFeatured: r.is_featured,
    inStock: r.variants_json.some((v) => v.in_stock),
    primaryImage: primary ? mapImage(primary) : null,
    swatches,
  };
}

function toDetail(r: ProductRow): ProductDetailDTO {
  const variants: VariantDTO[] = r.variants_json.map((v) => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
    hexColor: v.hex_color,
    hexColorSecondary: v.hex_color_secondary,
    finish: v.finish,
    priceCents: v.price_cents_override ?? r.base_price_cents,
    inStock: v.in_stock,
    isDefault: v.is_default,
    displayOrder: v.display_order,
    imageId: r.images_json.find((i) => i.variant_id === v.id)?.id ?? null,
  }));

  return {
    ...toSummary(r),
    description: r.description,
    ingredients: r.ingredients,
    howToUse: r.how_to_use,
    variantLabel: r.variant_label,
    variants,
    images: r.images_json.map(mapImage),
    meta: { title: r.meta_title, description: r.meta_description },
  };
}

/* ---------- categories ---------- */

export async function listCategories(pool: Pool): Promise<CategoryDTO[]> {
  return cached('catalog:categories', TTL, async () => {
    const { rows } = await pool.query<{
      id: string;
      parent_id: string | null;
      slug: string;
      name: string;
      description: string | null;
      display_order: number;
      product_count: string;
    }>(`
      select c.id, c.parent_id, c.slug, c.name, c.description, c.display_order,
             (select count(*) from products p
               where p.status = 'active'
                 and (p.category_id = c.id
                      or p.category_id in (select id from categories where parent_id = c.id))
             ) as product_count
        from categories c
       where c.is_active
       order by c.display_order, c.name
    `);

    const byId = new Map<string, CategoryDTO>();
    const roots: CategoryDTO[] = [];
    for (const r of rows) {
      byId.set(r.id, {
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        urlPath: '',
        displayOrder: r.display_order,
        productCount: Number(r.product_count),
        children: [],
      });
    }
    for (const r of rows) {
      const dto = byId.get(r.id)!;
      if (r.parent_id && byId.has(r.parent_id)) {
        const parent = byId.get(r.parent_id)!;
        dto.urlPath = `/shop/${parent.slug}/${dto.slug}`;
        parent.children.push(dto);
      } else {
        dto.urlPath = `/shop/${dto.slug}`;
        roots.push(dto);
      }
    }
    return roots;
  });
}

export async function getCategoryBySlug(pool: Pool, slug: string): Promise<CategoryDTO> {
  const all = await listCategories(pool);
  const flat: CategoryDTO[] = [];
  const walk = (cs: CategoryDTO[]) => cs.forEach((c) => { flat.push(c); walk(c.children); });
  walk(all);
  const found = flat.find((c) => c.slug === slug);
  if (!found) throw notFound('Category not found');
  return found;
}

/* ---------- products ---------- */

const SORTS: Record<string, string> = {
  featured: 'p.is_featured desc, p.display_order, p.name',
  newest: 'p.published_at desc nulls last, p.created_at desc',
  price_asc: 'p.base_price_cents asc, p.name',
  price_desc: 'p.base_price_cents desc, p.name',
  name: 'p.name asc',
};

export async function listProducts(
  pool: Pool,
  q: ProductListQuery,
): Promise<ProductListResponse> {
  const limit = Math.min(Math.max(q.limit ?? 24, 1), 60);
  const offset = Math.max(q.offset ?? 0, 0);
  const sort = q.sort ?? 'featured';
  const key = `catalog:list:${q.category ?? ''}:${q.featured ? 1 : 0}:${q.q ?? ''}:${sort}:${limit}:${offset}`;

  return cached(key, TTL, async () => {
    const where: string[] = [`p.status = 'active'`];
    const params: unknown[] = [];

    if (q.category) {
      params.push(q.category);
      where.push(`p.category_id in (
        select id from categories where slug = $${params.length}
        union
        select id from categories where parent_id = (select id from categories where slug = $${params.length})
      )`);
    }
    if (q.featured) where.push('p.is_featured');
    if (q.q) {
      params.push(q.q);
      where.push(`p.search_vector @@ plainto_tsquery('english', $${params.length})`);
    }

    params.push(limit, offset);
    // ONE round trip: rows + total via window function.
    const { rows } = await pool.query<ProductRow>(
      `${PRODUCT_SELECT}
        where ${where.join(' and ')}
        order by ${SORTS[sort] ?? SORTS.featured}
        limit $${params.length - 1} offset $${params.length}`
        .replace('select p.id,', 'select count(*) over() as total, p.id,'),
      params,
    );

    return {
      products: rows.map(toSummary),
      total: rows.length ? Number(rows[0]!.total) : 0,
      limit,
      offset,
    };
  });
}

export async function getProductSummariesByIds(
  pool: Pool,
  ids: string[],
): Promise<ProductSummaryDTO[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool.query<ProductRow>(
    `${PRODUCT_SELECT} where p.id = any($1::uuid[]) and p.status = 'active'`,
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.id, toSummary(r)]));
  return ids.map((id) => byId.get(id)).filter((s): s is ProductSummaryDTO => Boolean(s));
}

export async function getProductBySlug(pool: Pool, slug: string): Promise<ProductDetailDTO> {
  return cached(`catalog:product:${slug}`, TTL, async () => {
    const { rows } = await pool.query<ProductRow>(
      `${PRODUCT_SELECT} where p.slug = $1 and p.status = 'active'`,
      [slug],
    );
    if (!rows[0]) throw notFound('Product not found');
    return toDetail(rows[0]);
  });
}

/* ---------- settings ---------- */

export async function getSettings(pool: Pool): Promise<StoreSettingsDTO> {
  return cached('catalog:settings', TTL, async () => {
    const { rows } = await pool.query<{
      currency: string;
      flat_shipping_cents: number;
      free_shipping_threshold_cents: number | null;
      announcement: string | null;
      checkout_enabled: boolean;
      allowed_shipping_countries: string[];
    }>(`select * from store_settings where id`);
    const s = rows[0]!;
    return {
      currency: s.currency.trim(),
      flatShippingCents: s.flat_shipping_cents,
      freeShippingThresholdCents: s.free_shipping_threshold_cents,
      announcement: s.announcement,
      checkoutEnabled: s.checkout_enabled,
      allowedShippingCountries: s.allowed_shipping_countries.map((c) => c.trim()),
    };
  });
}
