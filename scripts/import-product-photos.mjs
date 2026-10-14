/**
 * Syncs product photography from backend/seed-assets/lips/<product-slug>/
 * into storage + product_images, linking every photo to its shade so the
 * storefront can show a gallery per shade.
 *
 * Two folder layouts, picked per product by PLAN:
 *
 *   coded   — the current delivery. Files are named "<CODE> <Shade Name>.png",
 *             optionally " (2)" for further angles of the same shade:
 *               <slug>/shades/HS01 Crystal Clear.png
 *               <slug>/shades/HS01 Crystal Clear (1).png
 *               <slug>/shared/High Shine shades.jpg
 *             Everything under shades/ must carry a code that exists in
 *             product_variants.shade_code (see migration 0012); everything
 *             under shared/ belongs to the product and is appended to every
 *             shade's gallery by the storefront.
 *
 *   legacy  — products still on the older delivery, where the gallery is a
 *             hand-written list of "Lip - <Product> - <Label>.jpg" files.
 *
 * - Applies migrations 0011 and 0012 first (idempotent) and records them in
 *   schema_migrations so the app's runner skips them.
 * - PLAN is the source of truth: image rows that are no longer wanted are
 *   removed. Their storage objects are deliberately kept — order_items
 *   snapshot image paths, so past orders must not lose thumbnails.
 * - Normalizes images exactly like the admin upload route (rotate, 1600px cap,
 *   webp q82) and uploads via the configured storage driver (supabase/local).
 * - Idempotent: storage paths are derived from the source file's content hash,
 *   so a re-run uploads nothing that is already there.
 *
 * Run from backend/ (the dev backend must be running — it hosts the embedded db):
 *   node scripts/import-product-photos.mjs [--dry-run]                local copy
 *   node scripts/import-product-photos.mjs --target=prod [--dry-run]  production
 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const DRY_RUN = process.argv.includes('--dry-run');

// ---------- env ----------
const env = {};
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2];
}
// Local embedded copy by default; production only when asked for explicitly.
const TARGET_PROD = process.argv.includes('--target=prod');
const DATABASE_URL = TARGET_PROD
  ? process.env.PROD_DATABASE_URL ?? env.PROD_DATABASE_URL
  : process.env.DATABASE_URL ?? env.DATABASE_URL ??
    `postgresql://revelle:revelle@localhost:${env.EMBEDDED_PG_PORT || 5544}/revelle`;
const STORAGE_DRIVER = TARGET_PROD
  ? 'supabase'
  : process.env.STORAGE_DRIVER ?? env.STORAGE_DRIVER ?? 'local';
const SUPABASE_URL = (process.env.SUPABASE_URL ?? env.SUPABASE_URL ?? '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? env.SUPABASE_STORAGE_BUCKET ?? 'product-images';
if (!DATABASE_URL) throw new Error('DATABASE_URL missing');
if (STORAGE_DRIVER === 'supabase' && (!SUPABASE_URL || !SUPABASE_KEY)) {
  throw new Error('STORAGE_DRIVER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: /supabase\.(co|com)/.test(DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
});
console.log(`target: ${TARGET_PROD ? 'PRODUCTION' : 'local'} database, ${STORAGE_DRIVER} storage`);

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
 * `layout: 'coded'` products are read straight off disk — shades/ and shared/.
 * `layout: 'legacy'` products list their gallery by label, in display order
 * (first = primary), as [label, variant slug or null for product-level shots].
 * `publish` activates a draft product once it has photography.
 */
const PLAN = {
  'high-shine-lip-oil': { layout: 'coded' },
  'lip-lustre-lip-gloss': { layout: 'coded' },
  'creamy-matte-lipstick': { layout: 'coded' },
  'long-lasting-matte-liquid-lipstick': { layout: 'coded', publish: true },
  'diamond-lip-gloss': { layout: 'coded' },
  'nourishing-lip-tint': { layout: 'coded' },
  'matte-lip-liner': { layout: 'coded', publish: true },

  // Still on the older delivery: their photos are named by shade, not by code,
  // so they keep the galleries they have until coded photography arrives.
  'ultra-light-lip-oil': {
    layout: 'legacy',
    name: 'Ultra Light Lip Oil',
    photos: [
      ['Pure Glow', 'pure-glow'],
      ['Clear Shine', 'clear-shine'],
      ['Pink Glow', 'pink-glow'],
      ['Glitter Glaze', 'glitter-glaze'],
      ['Berry Kiss', 'berry-kiss'],
      ['Cherry Pop', 'cherry-pop'],
      ['Honey Glow', 'honey-glow'],
      ['Banner', null],
      ['Line Sheet', null],
      ['Line Sheet Ice Cube', null],
    ],
  },
  'magic-tone-lip': {
    layout: 'legacy',
    name: 'Magic Tone Lip Oil',
    photos: [
      ['Trio', null],
      ['Vanilla', 'vanilla'],
      ['Sakura', 'sakura'],
      ['Sakura Before After', 'sakura'],
      ['Black Currant', 'black-currant'],
      ['Trio Flatlay', null],
      ['Trio Silk', null],
      ['Trio Silk Flatlay', null],
      ['Swatches', null],
      ['Arm Swatches', null],
      ['Line Sheet', null],
    ],
  },
  'lip-gloss-hyaluronic-acid': {
    layout: 'legacy',
    name: 'Hyaluronic Acid Lip Gloss',
    photos: [
      ['Duo', null],
      ['Clear', 'hydra-clear'],
      ['Infographic Hydrating', null],
      ['Infographic Iridescent', null],
      ['Infographic Lips', null],
      ['Infographic Before After', null],
      ['Infographic Plumps', null],
      ['Line Sheet', null],
    ],
  },
  'sugar-lip-scrub': {
    layout: 'legacy',
    name: 'Sugar Lip Scrub',
    photos: [
      ['Jar', null],
      ['Jar Swatch', null],
      ['Open Jar', null],
      ['Sugar Cubes', null],
      ['With Box', null],
      ['Model', null],
      ['Infographic', null],
      ['Lip Therapy Set', null],
    ],
  },
  'peptide-lip-lacquer': {
    layout: 'legacy',
    name: 'Peptide Lip Lacquer',
    publish: true,
    photos: [
      ['Collection', null],
      ['Arm Swatches Named', null],
      ['Lifestyle', null],
      ['Tube Pink', null],
      ['Tube Peach Pink', null],
      ['Tube Cherry', null],
      ['Tube Chocolate', null],
      ['Tube White', null],
      ['Tube White On Black', null],
      ['Swatch Chart', null],
      ['Arm Swatches', null],
      ['Line Sheet', null],
    ],
  },
};

/** "HS01 Crystal Clear (2).png" -> { code: 'HS01', name: 'Crystal Clear', seq: 2 } */
const CODED_FILE = /^([A-Z]{1,3}\d{2,4})\s+(.+?)(?:\s*[(_](\d+)\)?)?$/;

function parseCodedName(file) {
  const m = path.basename(file, path.extname(file)).match(CODED_FILE);
  return m ? { code: m[1], name: m[2].trim(), seq: m[3] ? Number(m[3]) : 0 } : null;
}

function findPhoto(dir, productName, label) {
  const base = `Lip - ${productName} - ${label}`;
  for (const ext of ['.png', '.jpg', '.jpeg']) {
    const file = path.join(dir, base + ext);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

async function applyMigrations() {
  // Same rule as the app's runner: a file runs once, in order. 0011 must not be
  // replayed on a database that already has 0012 — 0012 reslugs the shades 0011
  // created, so a replay would try to insert them a second time.
  const { rows } = await pool.query(
    `select filename from schema_migrations`,
  ).catch(() => ({ rows: [] }));
  const applied = new Set(rows.map((r) => r.filename));

  for (const migFile of [
    '0011_real_lip_shades.sql', '0012_shade_catalog.sql',
    '0013_us_prices.sql', '0014_image_thumbnails.sql',
  ]) {
    if (applied.has(migFile)) {
      console.log(`already applied: ${migFile}`);
      continue;
    }
    const migSql = fs.readFileSync(path.join(root, 'migrations', migFile), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(migSql);
      await client.query(
        `insert into schema_migrations (filename) values ($1) on conflict do nothing`,
        [migFile],
      );
      if (DRY_RUN) await client.query('rollback');
      else await client.query('commit');
      console.log(`${DRY_RUN ? 'checked' : 'applied'} ${migFile}`);
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }
}

/**
 * Coded layout: shades/ grouped by code in the shade's display order, each
 * shade's own angles first (the plain filename, then " (1)", " (2)"…),
 * then shared/ product-level shots.
 */
function collectCoded(dir, productSlug, product, variants) {
  const byCode = new Map(variants.filter((v) => v.shade_code).map((v) => [v.shade_code, v]));
  const shadesDir = path.join(dir, 'shades');
  const sharedDir = path.join(dir, 'shared');
  if (!fs.existsSync(shadesDir)) throw new Error(`${productSlug}: missing shades/ folder`);

  const grouped = new Map();
  for (const file of fs.readdirSync(shadesDir)) {
    const parsed = parseCodedName(file);
    if (!parsed) throw new Error(`${productSlug}: shades/${file} has no shade code`);
    if (!byCode.has(parsed.code)) {
      throw new Error(
        `${productSlug}: shades/${file} is shade ${parsed.code}, which is not in the ` +
          `catalog — add it to migrations/0012_shade_catalog.sql first`,
      );
    }
    if (!grouped.has(parsed.code)) grouped.set(parsed.code, []);
    grouped.get(parsed.code).push({ file: path.join(shadesDir, file), ...parsed });
  }

  const unphotographed = variants.filter((v) => v.shade_code && !grouped.has(v.shade_code));
  if (unphotographed.length) {
    console.log(
      `  ! ${productSlug}: no photo for ${unphotographed.map((v) => v.shade_code).join(', ')}`,
    );
  }

  const out = [];
  for (const v of variants) {
    const files = grouped.get(v.shade_code);
    if (!files) continue;
    files.sort((a, b) => a.seq - b.seq || a.file.localeCompare(b.file));
    for (const f of files) {
      out.push({
        file: f.file,
        variantId: v.id,
        altText: `${product.name} — ${v.shade_code} ${v.name}`,
      });
    }
  }
  if (fs.existsSync(sharedDir)) {
    for (const file of fs.readdirSync(sharedDir).sort()) {
      out.push({
        file: path.join(sharedDir, file),
        variantId: null,
        altText: product.name,
      });
    }
  }
  return out;
}

/** Legacy layout: the PLAN's label list, resolved against the flat folder. */
function collectLegacy(dir, productSlug, plan, product, variants) {
  const variantBySlug = new Map(variants.map((v) => [v.slug, v.id]));
  const planned = new Set();
  const out = [];
  for (const [label, variantSlug] of plan.photos) {
    const file = findPhoto(dir, plan.name, label);
    if (!file) throw new Error(`${productSlug}: missing photo "${label}"`);
    planned.add(path.basename(file));
    const variantId = variantSlug ? variantBySlug.get(variantSlug) : null;
    if (variantSlug && !variantId) throw new Error(`${productSlug}: variant ${variantSlug} missing`);
    out.push({ file, variantId, altText: `${product.name} — ${label}` });
  }
  const strays = fs.readdirSync(dir).filter((f) => !planned.has(f));
  if (strays.length) throw new Error(`${productSlug}: files not in PLAN: ${strays.join(', ')}`);
  return out;
}

async function syncProduct(productSlug, plan, assetsRoot, totals) {
  const dir = path.join(assetsRoot, productSlug);
  const { rows: [product] } = await pool.query(
    `select id, name, status from products where slug = $1`, [productSlug],
  );
  if (!product) throw new Error(`product not found: ${productSlug}`);

  const { rows: variants } = await pool.query(
    `select id, slug, name, shade_code from product_variants
      where product_id = $1 order by display_order`, [product.id],
  );

  const collected = plan.layout === 'coded'
    ? collectCoded(dir, productSlug, product, variants)
    : collectLegacy(dir, productSlug, plan, product, variants);

  const wanted = collected.map((c, index) => {
    const raw = fs.readFileSync(c.file);
    const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
    return {
      ...c,
      raw,
      storagePath: `products/${product.id}/${hash}.webp`,
      // Card-sized twin of the same source; cards and thumbnails read this.
      storagePathSm: `products/${product.id}/${hash}-sm.webp`,
      isPrimary: index === 0,
      displayOrder: index + 1,
    };
  });

  const { rows: existing } = await pool.query(
    `select id, storage_path, storage_path_sm from product_images where product_id = $1`,
    [product.id],
  );
  const existingByPath = new Map(existing.map((r) => [r.storage_path, r]));
  const wantedPaths = new Set(wanted.map((w) => w.storagePath));
  const toRemove = existing.filter((r) => !wantedPaths.has(r.storage_path));
  const toUpload = wanted.filter((w) => !existingByPath.has(w.storagePath));
  // Rows that pre-date the derivative still need their small twin made.
  const toThumb = wanted.filter((w) => !existingByPath.get(w.storagePath)?.storage_path_sm);
  const shadeLinked = wanted.filter((w) => w.variantId).length;

  console.log(
    `${productSlug}: ${wanted.length} photos (${shadeLinked} on shades) — ` +
      `${toUpload.length} to upload, ${toThumb.length - toUpload.length} to resize, ` +
      `${wanted.length - toUpload.length} kept, ` +
      `${toRemove.length} rows to remove` +
      (plan.publish && product.status === 'draft' ? ', publish draft' : ''),
  );
  totals.uploaded += toUpload.length;
  totals.removed += toRemove.length;
  if (DRY_RUN) return;

  // Upload before touching rows so the live gallery never points at a missing object.
  for (const w of toUpload) {
    const buf = await sharp(w.raw).rotate().resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 82 }).toBuffer();
    const meta = await sharp(buf).metadata();
    w.width = meta.width ?? null;
    w.height = meta.height ?? null;
    await putObject(w.storagePath, buf);
  }

  // The card-sized twin. Quality can drop a little at this size without
  // showing, and it is the file a shop page actually downloads.
  for (const w of toThumb) {
    const small = await sharp(w.raw).rotate().resize({ width: 640, withoutEnlargement: true })
      .webp({ quality: 76 }).toBuffer();
    await putObject(w.storagePathSm, small);
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    // One primary per product is enforced by a unique index — clear first.
    await client.query(`update product_images set is_primary = false where product_id = $1`, [product.id]);
    if (toRemove.length) {
      await client.query(`delete from product_images where id = any($1::uuid[])`, [
        toRemove.map((r) => r.id),
      ]);
    }
    for (const w of wanted) {
      const row = existingByPath.get(w.storagePath);
      if (row) {
        await client.query(
          `update product_images
              set variant_id = $2, alt_text = $3, is_primary = $4, display_order = $5,
                  storage_path_sm = $6
            where id = $1`,
          [row.id, w.variantId, w.altText, w.isPrimary, w.displayOrder, w.storagePathSm],
        );
      } else {
        await client.query(
          `insert into product_images
             (product_id, variant_id, storage_path, storage_path_sm, alt_text,
              width, height, is_primary, display_order)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [product.id, w.variantId, w.storagePath, w.storagePathSm, w.altText,
           w.width, w.height, w.isPrimary, w.displayOrder],
        );
      }
    }
    if (plan.publish) {
      await client.query(
        `update products set status = 'active' where id = $1 and status = 'draft'`, [product.id],
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

async function main() {
  await applyMigrations();

  const assetsRoot = path.join(root, 'seed-assets', 'lips');
  const unplanned = fs.readdirSync(assetsRoot).filter((d) => !(d in PLAN));
  if (unplanned.length) throw new Error(`folders without a PLAN entry: ${unplanned.join(', ')}`);

  const totals = { uploaded: 0, removed: 0 };
  for (const [productSlug, plan] of Object.entries(PLAN)) {
    await syncProduct(productSlug, plan, assetsRoot, totals);
  }
  console.log(
    `${DRY_RUN ? 'dry run' : 'done'}: ${totals.uploaded} uploaded, ${totals.removed} stale rows removed`,
  );

  const { rows } = await pool.query(`
    select p.slug, p.status, count(i.id)::int images, count(i.variant_id)::int shade_linked
    from products p join product_images i on i.product_id = p.id
    group by p.slug, p.status order by p.slug`);
  console.table(rows);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
