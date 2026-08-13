/**
 * Imports product photography from backend/seed-assets/lips/<product-slug>/
 * into storage + product_images, linking each photo to its shade variant so
 * the storefront swaps the hero image when a shade is selected.
 *
 * - Applies 0011_real_lip_shades.sql first (idempotent) and records it in
 *   schema_migrations so the app's runner skips it.
 * - Normalizes images exactly like the admin upload route (rotate, 1600px cap,
 *   webp q82) and uploads via the configured storage driver (supabase/local).
 * - Idempotent: a photo whose alt_text already exists for the product is skipped.
 *
 * Run from backend/:  node scripts/import-product-photos.mjs
 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// ---------- env ----------
const env = {};
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}
const DATABASE_URL = process.env.DATABASE_URL ?? env.DATABASE_URL;
const STORAGE_DRIVER = process.env.STORAGE_DRIVER ?? env.STORAGE_DRIVER ?? 'local';
const SUPABASE_URL = (process.env.SUPABASE_URL ?? env.SUPABASE_URL ?? '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? env.SUPABASE_STORAGE_BUCKET ?? 'product-images';
if (!DATABASE_URL) throw new Error('DATABASE_URL missing');
if (STORAGE_DRIVER === 'supabase' && (!SUPABASE_URL || !SUPABASE_KEY)) {
  throw new Error('STORAGE_DRIVER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function putObject(storagePath, buf) {
  if (STORAGE_DRIVER === 'supabase') {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${SUPABASE_KEY}`,
        'content-type': 'image/webp',
        'cache-control': 'max-age=31536000',
        'x-upsert': 'true',
      },
      body: new Uint8Array(buf),
    });
    if (!res.ok) throw new Error(`storage upload failed ${res.status}: ${await res.text()}`);
  } else {
    const full = path.join(root, 'uploads', storagePath);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, buf);
  }
}

/**
 * Per product: filename stem (before any " (n)") → variant slug, or null for
 * product-level marketing shots. `primary` names the photo that should be the
 * product's primary image.
 */
const PLAN = {
  'high-shine-lip-oil': {
    primary: 'Lip - High Shine Lip Oil - Duo Fuchsia Coral',
    map: {
      'Clear': 'clear',
      'Peach Nude': 'peach-nude',
      'Pink Blossom': 'pink-blossom',
      'Rosewood': 'rosewood',
      'Fuchsia Kiss': 'fuchsia-kiss',
      'Berry Blush': 'berry-blush',
      'Duo Fuchsia Coral': null,
      'Swatch Chart': null,
      'Arm Swatches': null,
      'Banner': null,
      'Line Sheet': null,
      'Shade Grid': null,
    },
  },
  'ultra-light-lip-oil': {
    primary: 'Lip - Ultra Light Lip Oil - Pure Glow',
    map: {
      'Cherry Pop': 'cherry-pop',
      'Pink Glow': 'pink-glow',
      'Clear Shine': 'clear-shine',
      'Glitter Glaze': 'glitter-glaze',
      'Berry Kiss': 'berry-kiss',
      'Pure Glow': 'pure-glow',
      'Honey Glow': 'honey-glow',
    },
  },
  'lip-lustre-lip-gloss': {
    primary: 'Lip - Lustre Lip Gloss - Soft Nude',
    map: {
      'Sunset Glow': 'sunset-glow',
      'True Red': 'true-red',
      'Cherry Wine': 'cherry-wine',
      'Golden Shimmer': 'golden-shimmer',
      'Coral Kiss': 'coral-kiss',
      'Crystal Clear': 'crystal-clear',
      'Soft Nude': 'soft-nude',
      'Berry Blush': 'berry-blush',
      'Banner': null,
    },
  },
  'diamond-lip-gloss': {
    primary: 'Lip - Diamond Lip Gloss - Collection',
    map: {
      'Diamond Clear': 'diamond-clear',
      'Collection': null,
      'Infographic': null,
    },
  },
  'magic-tone-lip': {
    primary: 'Lip - Magic Tone Lip Oil - Trio',
    map: {
      'Sakura': 'sakura',
      'Vanilla': 'vanilla',
      'Black Currant': 'black-currant',
      'Swatches': null,
      'Trio': null,
    },
  },
  'lip-gloss-hyaluronic-acid': {
    primary: 'Lip - Hyaluronic Acid Lip Gloss - Duo',
    map: {
      'Clear': 'hydra-clear',
      'Duo': null,
      'Infographic': null,
    },
  },
  'nourishing-lip-tint': {
    primary: 'Lip - Nourishing Lip Tint - Trio',
    map: {
      'Coral': 'coral',
      'Scarlet': 'scarlet',
      'Ruby Red': 'ruby-red',
      'Wine': 'wine',
      'Black Cherry': 'black-cherry',
      'Trio': null,
      'Collection': null,
    },
  },
  'sugar-lip-scrub': {
    primary: 'Lip - Sugar Lip Scrub - Jar',
    map: {
      'Jar': null,
      'Sugar Cubes': null,
      'With Box': null,
      'Infographic': null,
      'Model': null,
    },
  },
};

/** "Lip - Product - Color (2).jpg" → { stem: "Lip - Product - Color", color: "Color" } */
function parseName(file) {
  const base = file.replace(/\.jpg$/i, '');
  const stem = base.replace(/ \(\d+\)$/, '');
  const parts = stem.split(' - ');
  return { base, stem, color: parts[2] ?? '' };
}

async function main() {
  // 1) real shades migration (idempotent), recorded so the boot runner skips it
  const migFile = '0011_real_lip_shades.sql';
  const migSql = fs.readFileSync(path.join(root, 'migrations', migFile), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(migSql);
    await client.query(
      `insert into schema_migrations (filename) values ($1) on conflict do nothing`,
      [migFile],
    );
    await client.query('commit');
    console.log(`applied ${migFile}`);
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }

  // 2) photos
  const assetsRoot = path.join(root, 'seed-assets', 'lips');
  let uploaded = 0;
  let skipped = 0;

  for (const [productSlug, plan] of Object.entries(PLAN)) {
    const dir = path.join(assetsRoot, productSlug);
    if (!fs.existsSync(dir)) {
      console.warn(`missing folder: ${dir}`);
      continue;
    }
    const { rows: [product] } = await pool.query(
      `select id from products where slug = $1`, [productSlug],
    );
    if (!product) {
      console.warn(`product not found: ${productSlug}`);
      continue;
    }
    const { rows: variants } = await pool.query(
      `select id, slug from product_variants where product_id = $1`, [product.id],
    );
    const variantBySlug = Object.fromEntries(variants.map((v) => [v.slug, v.id]));

    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.jpg')).sort();
    for (const file of files) {
      const { base, color } = parseName(file);
      if (!(color in plan.map)) {
        console.warn(`  unmapped photo (uploaded product-level): ${file}`);
      }
      const variantSlug = plan.map[color] ?? null;
      const variantId = variantSlug ? variantBySlug[variantSlug] ?? null : null;
      if (variantSlug && !variantId) {
        console.warn(`  variant ${variantSlug} missing for ${productSlug} — linking product-level`);
      }

      const { rows: existing } = await pool.query(
        `select 1 from product_images where product_id = $1 and alt_text = $2`,
        [product.id, base],
      );
      if (existing.length) {
        skipped++;
        continue;
      }

      const raw = fs.readFileSync(path.join(dir, file));
      const buf = await sharp(raw).rotate().resize({ width: 1600, withoutEnlargement: true })
        .webp({ quality: 82 }).toBuffer();
      const meta = await sharp(buf).metadata();

      const imageId = crypto.randomUUID();
      const storagePath = `products/${product.id}/${imageId}.webp`;
      await putObject(storagePath, buf);

      await pool.query(
        `insert into product_images
           (id, product_id, variant_id, storage_path, alt_text, width, height, is_primary, display_order)
         values ($1,$2,$3,$4,$5,$6,$7,false,
                 coalesce((select max(display_order) + 1 from product_images where product_id = $2), 1))`,
        [imageId, product.id, variantId, storagePath, base, meta.width ?? null, meta.height ?? null],
      );
      uploaded++;
      console.log(`  + ${productSlug} ← ${file}${variantSlug ? `  [shade: ${variantSlug}]` : ''}`);
    }

    // deterministic primary
    await pool.query(
      `update product_images set is_primary = (alt_text = $2)
       where product_id = $1
         and exists (select 1 from product_images where product_id = $1 and alt_text = $2)`,
      [product.id, plan.primary],
    );
  }

  console.log(`done: ${uploaded} uploaded, ${skipped} already present`);

  const { rows } = await pool.query(`
    select p.slug, count(i.id) images, count(i.variant_id) shade_linked
    from products p join product_images i on i.product_id = p.id
    group by p.slug order by p.slug`);
  console.table(rows);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
