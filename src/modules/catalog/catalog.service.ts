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

/* ---------- row types ---------- */

interface VariantRow {
  id: string;
  product_id: string;
  name: string;
  slug: string;
  hex_color: string | null;
  hex_color_secondary: string | null;
  finish: string | null;
  price_cents_override: number | null;
  stock_quantity: number;
  is_available: boolean;
  is_default: boolean;
  display_order: number;
}

interface ImageRow {
  id: string;
  product_id: string;
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
  track_inventory: boolean;
  variant_label: string;
  is_featured: boolean;
  meta_title: string | null;
  meta_description: string | null;
}

/* ---------- mapping ---------- */

function mapImage(r: ImageRow): ImageDTO {
  return {
    id: r.id,
    url: storage.publicUrl(r.storage_path),
    altText: r.alt_text,
    width: r.width,
    height: r.height,
    isPrimary: r.is_primary,
    variantId: r.variant_id,
    displayOrder: r.display_order,
  };
}

function variantInStock(v: VariantRow, trackInventory: boolean): boolean {
  return v.is_available && (!trackInventory || v.stock_quantity > 0);
}

function mapVariant(v: VariantRow, basePriceCents: number, trackInventory: boolean): VariantDTO {
  // Effective price = COALESCE(override, base) — resolved here, once.
  const imageId = null; // filled by caller when variant images exist
  return {
    id: v.id,
    name: v.name,
    slug: v.slug,
    hexColor: v.hex_color,
    hexColorSecondary: v.hex_color_secondary,
    finish: v.finish,
    priceCents: v.price_cents_override ?? basePriceCents,
    inStock: variantInStock(v, trackInventory),
    isDefault: v.is_default,
    displayOrder: v.display_order,
    imageId,
  };
}

/* ---------- categories ---------- */

export async function listCategories(pool: Pool): Promise<CategoryDTO[]> {
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
      urlPath: '', // set below
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
  const where: string[] = [`p.status = 'active'`];
  const params: unknown[] = [];

  if (q.category) {
    params.push(q.category);
    // Matches the category OR any of its children.
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

  const orderBy = SORTS[q.sort ?? 'featured'] ?? SORTS.featured;
  const limit = Math.min(Math.max(q.limit ?? 24, 1), 60);
  const offset = Math.max(q.offset ?? 0, 0);

  const countSql = `select count(*) from products p where ${where.join(' and ')}`;
  const { rows: countRows } = await pool.query<{ count: string }>(countSql, params);
  const total = Number(countRows[0]?.count ?? 0);

  params.push(limit, offset);
  const { rows: products } = await pool.query<ProductRow>(
    `select p.id, p.category_id, c.slug as category_slug, p.slug, p.name, p.tagline,
            p.description, p.ingredients, p.how_to_use,
            p.base_price_cents, p.compare_at_price_cents, p.track_inventory,
            p.variant_label, p.is_featured, p.meta_title, p.meta_description
       from products p
       join categories c on c.id = p.category_id
      where ${where.join(' and ')}
      order by ${orderBy}
      limit $${params.length - 1} offset $${params.length}`,
    params,
  );

  const summaries = await buildSummaries(pool, products);
  return { products: summaries, total, limit, offset };
}

async function buildSummaries(pool: Pool, products: ProductRow[]): Promise<ProductSummaryDTO[]> {
  if (products.length === 0) return [];
  const ids = products.map((p) => p.id);

  const { rows: variants } = await pool.query<VariantRow>(
    `select * from product_variants where product_id = any($1::uuid[]) order by display_order`,
    [ids],
  );
  const { rows: images } = await pool.query<ImageRow>(
    `select * from product_images where product_id = any($1::uuid[]) order by display_order`,
    [ids],
  );

  return products.map((p) => {
    const pv = variants.filter((v) => v.product_id === p.id);
    const prices = pv.map((v) => v.price_cents_override ?? p.base_price_cents);
    const primary = images.find((i) => i.product_id === p.id && i.is_primary)
      ?? images.find((i) => i.product_id === p.id);

    const swatches: SwatchDTO[] = pv
      .filter((v) => v.hex_color)
      .map((v) => ({
        id: v.id,
        name: v.name,
        slug: v.slug,
        hexColor: v.hex_color,
        hexColorSecondary: v.hex_color_secondary,
      }));

    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      tagline: p.tagline,
      categoryId: p.category_id,
      categorySlug: p.category_slug,
      priceCents: prices.length ? Math.min(...prices) : p.base_price_cents,
      priceMaxCents: prices.length ? Math.max(...prices) : p.base_price_cents,
      compareAtPriceCents: p.compare_at_price_cents,
      isFeatured: p.is_featured,
      inStock: pv.some((v) => variantInStock(v, p.track_inventory)),
      primaryImage: primary ? mapImage(primary) : null,
      swatches,
    };
  });
}

export async function getProductBySlug(pool: Pool, slug: string): Promise<ProductDetailDTO> {
  const { rows } = await pool.query<ProductRow>(
    `select p.id, p.category_id, c.slug as category_slug, p.slug, p.name, p.tagline,
            p.description, p.ingredients, p.how_to_use,
            p.base_price_cents, p.compare_at_price_cents, p.track_inventory,
            p.variant_label, p.is_featured, p.meta_title, p.meta_description
       from products p
       join categories c on c.id = p.category_id
      where p.slug = $1 and p.status = 'active'`,
    [slug],
  );
  const p = rows[0];
  if (!p) throw notFound('Product not found');

  const [summary] = await buildSummaries(pool, [p]);

  const { rows: variantRows } = await pool.query<VariantRow>(
    `select * from product_variants where product_id = $1 order by display_order`,
    [p.id],
  );
  const { rows: imageRows } = await pool.query<ImageRow>(
    `select * from product_images where product_id = $1 order by display_order`,
    [p.id],
  );

  const variants = variantRows.map((v) => {
    const dto = mapVariant(v, p.base_price_cents, p.track_inventory);
    const vImage = imageRows.find((i) => i.variant_id === v.id);
    return { ...dto, imageId: vImage?.id ?? null };
  });

  return {
    ...summary!,
    description: p.description,
    ingredients: p.ingredients,
    howToUse: p.how_to_use,
    variantLabel: p.variant_label,
    variants,
    images: imageRows.map(mapImage),
    meta: { title: p.meta_title, description: p.meta_description },
  };
}

/* ---------- settings ---------- */

export async function getSettings(pool: Pool): Promise<StoreSettingsDTO> {
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
}
