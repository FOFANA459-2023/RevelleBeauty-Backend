/**
 * Syncs product photography from backend/seed-assets/lips/ into storage +
 * product_images, linking every photo to its shade so the storefront can show
 * a gallery per shade.
 *
 * One layout, mirroring how the brand delivers photos — a folder per shade:
 *
 *   <product-slug>/shades/<variant-slug>/*.png   that shade's own photographs
 *   <product-slug>/shared/*.png                  the product's: line sheets,
 *                                                charts, lifestyle. Appended to
 *                                                every shade's gallery.
 *
 * A shade folder is named by the variant's slug, so nothing is parsed out of
 * filenames. Every shade folder must name a variant that exists (the catalog
 * is defined by migrations — see 0015); a variant with no folder is reported.
 *
 * - Applies any migration not yet in schema_migrations, in order, the same rule
 *   as the app's runner — so this can run against a database the app has not
 *   booted against yet.
 * - The folders are the source of truth: image rows no longer wanted are
 *   removed. Their storage objects are deliberately kept — order_items
 *   snapshot image paths, so past orders must not lose thumbnails.
 * - Each photo is stored twice: ~1600px for the product page and ~640px for
 *   cards, thumbnails and hover reels (storage_path_sm).
 * - Within a shade, product shots on white lead and before/after cards follow,
 *   so a shade's window opens on the product itself.
 * - Idempotent: storage paths derive from the source file's content hash, so a
 *   re-run uploads nothing that is already there.
 *
 * Run from backend/ (the dev backend must be running — it hosts the embedded db):
 *   node scripts/import-product-photos.mjs [--dry-run]                local copy
 *   node scripts/import-product-photos.mjs --target=prod [--dry-run]  production
 *
 * --dry-run applies pending migrations inside a transaction it rolls back, so
 * it cannot preview work that depends on a migration not yet applied for real.
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

const isImage = (f) => /\.(png|jpe?g|webp)$/i.test(f);
const listImages = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(isImage) : []);
const naturally = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

async function applyMigrations() {
  const migDir = path.join(root, 'migrations');
  const { rows } = await pool.query(`select filename from schema_migrations`)
    .catch(() => ({ rows: [] }));
  const applied = new Set(rows.map((r) => r.filename));
  const pending = fs.readdirSync(migDir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f) && !applied.has(f))
    .sort();
  if (!pending.length) console.log('migrations: up to date');

  for (const migFile of pending) {
    const migSql = fs.readFileSync(path.join(migDir, migFile), 'utf8');
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
 * Share of near-white pixels. A product shot on white scores high, a
 * before/after card or a lifestyle frame low — used to let the product itself
 * lead each shade's window.
 */
async function whiteness(file) {
  const { data, info } = await sharp(file).resize(64, 64, { fit: 'fill' })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let white = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235) white++;
  }
  return white / (info.width * info.height);
}

async function orderShade(dir) {
  const files = await Promise.all(listImages(dir).map(async (f) => {
    const full = path.join(dir, f);
    return { file: full, card: /before\s*and\s*after/i.test(f), white: await whiteness(full) };
  }));
  // product on white first, then everything else; cards last; names to break ties
  return files.sort((a, b) =>
    Number(a.card) - Number(b.card) ||
    Number(b.white > 0.45) - Number(a.white > 0.45) ||
    naturally(path.basename(a.file), path.basename(b.file)),
  ).map((f) => f.file);
}

async function collect(dir, productSlug, product, variants) {
  const bySlug = new Map(variants.map((v) => [v.slug, v]));
  const shadesDir = path.join(dir, 'shades');
  const folders = fs.existsSync(shadesDir)
    ? fs.readdirSync(shadesDir).filter((d) => fs.statSync(path.join(shadesDir, d)).isDirectory())
    : [];

  for (const folder of folders) {
    if (!bySlug.has(folder)) {
      throw new Error(
        `${productSlug}: shades/${folder} names no shade in the catalog — ` +
          `add it to a migration first`,
      );
    }
  }
  const photographed = new Set(folders);
  const bare = variants.filter((v) => v.hex_color && !photographed.has(v.slug));
  if (bare.length && folders.length) {
    console.log(`  ! ${productSlug}: no photographs for ${bare.map((v) => v.slug).join(', ')}`);
  }

  const out = [];
  for (const v of variants) {
    if (!photographed.has(v.slug)) continue;
    const label = v.shade_code ? `${v.shade_code} ${v.name}` : v.name;
    for (const file of await orderShade(path.join(shadesDir, v.slug))) {
      out.push({ file, variantId: v.id, altText: `${product.name} — ${label}` });
    }
  }
  for (const f of listImages(path.join(dir, 'shared')).sort(naturally)) {
    out.push({ file: path.join(dir, 'shared', f), variantId: null, altText: product.name });
  }
  return out;
}

async function syncProduct(productSlug, assetsRoot, totals) {
  const dir = path.join(assetsRoot, productSlug);
  const { rows: [product] } = await pool.query(
    `select id, name, status from products where slug = $1`, [productSlug],
  );
  if (!product) throw new Error(`product not found: ${productSlug}`);

  const { rows: variants } = await pool.query(
    `select id, slug, name, shade_code, hex_color from product_variants
      where product_id = $1 order by display_order`, [product.id],
  );

  const collected = await collect(dir, productSlug, product, variants);

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

  // The same photograph can sit in two shade folders (a duo shot, say). One
  // row per stored object: the first shade to claim it keeps it.
  const seen = new Set();
  const unique = wanted.filter((w) => !seen.has(w.storagePath) && seen.add(w.storagePath));

  const { rows: existing } = await pool.query(
    `select id, storage_path, storage_path_sm from product_images where product_id = $1`,
    [product.id],
  );
  const existingByPath = new Map(existing.map((r) => [r.storage_path, r]));
  const wantedPaths = new Set(unique.map((w) => w.storagePath));
  const toRemove = existing.filter((r) => !wantedPaths.has(r.storage_path));
  const toUpload = unique.filter((w) => !existingByPath.has(w.storagePath));
  // Rows that pre-date the derivative still need their small twin made.
  const toThumb = unique.filter((w) => !existingByPath.get(w.storagePath)?.storage_path_sm);
  const shadeLinked = unique.filter((w) => w.variantId).length;

  console.log(
    `${productSlug}: ${unique.length} photos (${shadeLinked} on shades) — ` +
      `${toUpload.length} to upload, ${unique.length - toUpload.length} kept, ` +
      `${toRemove.length} rows to remove`,
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
    for (const w of unique) {
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
    await client.query(
      `update products set status = 'active' where id = $1 and status = 'draft'`, [product.id],
    );
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
  const products = fs.readdirSync(assetsRoot)
    .filter((d) => fs.statSync(path.join(assetsRoot, d)).isDirectory())
    .sort();

  const totals = { uploaded: 0, removed: 0 };
  for (const productSlug of products) {
    await syncProduct(productSlug, assetsRoot, totals);
  }
  console.log(
    `${DRY_RUN ? 'dry run' : 'done'}: ${totals.uploaded} uploaded, ${totals.removed} stale rows removed`,
  );

  const { rows } = await pool.query(`
    select p.slug, count(i.id)::int images, count(i.variant_id)::int shade_linked,
           count(i.storage_path_sm)::int with_thumb
    from products p join product_images i on i.product_id = p.id
    group by p.slug order by p.slug`);
  console.table(rows);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
