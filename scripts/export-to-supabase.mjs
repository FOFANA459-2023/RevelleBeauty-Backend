/**
 * Exports the local dev database into a single SQL file that recreates
 * schema + functions + ALL data (with original UUIDs) on Supabase.
 * Output: backend/migrations/supabase_full_migration.sql (gitignored-safe:
 * contains only catalog/test data, no secrets).
 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const pool = new pg.Pool({
  connectionString: process.env.SOURCE_DATABASE_URL ?? 'postgresql://revelle:revelle@localhost:5544/revelle',
});

const lit = (v) => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (Array.isArray(v)) return `array[${v.map(lit).join(',')}]::char(2)[]`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
  return `'${String(v).replaceAll("'", "''")}'`;
};

async function dumpTable(name, columns, { cast = {} } = {}) {
  const { rows } = await pool.query(`select ${columns.join(', ')} from ${name}`);
  if (rows.length === 0) return `-- ${name}: empty\n`;
  const lines = rows.map((r) => {
    const vals = columns.map((c) => {
      const v = lit(r[c]);
      return cast[c] ? `${v}::${cast[c]}` : v;
    });
    return `insert into ${name} (${columns.join(', ')}) values (${vals.join(', ')});`;
  });
  return `-- ${name} (${rows.length} rows)\n${lines.join('\n')}\n`;
}

const parts = [];

parts.push('-- ============ REVELLE BEAUTY: full migration to Supabase ============');
parts.push('-- Generated from the local dev database. Runs in one transaction.');
parts.push('begin;\n');

// 1) schema + functions, verbatim from the canonical migration files
for (const f of ['0001_init.sql', '0002_functions.sql']) {
  parts.push(`-- ============ ${f} ============`);
  parts.push(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
}

// 2) data, FK-ordered
parts.push('-- ============ DATA ============');
parts.push(await dumpTable('categories',
  ['id', 'parent_id', 'name', 'slug', 'description', 'hero_image_path', 'display_order', 'is_active', 'created_at', 'updated_at']));
parts.push(await dumpTable('products',
  ['id', 'category_id', 'slug', 'name', 'tagline', 'description', 'ingredients', 'how_to_use',
   'base_price_cents', 'compare_at_price_cents', 'currency', 'sku', 'status', 'track_inventory',
   'variant_label', 'is_featured', 'display_order', 'meta_title', 'meta_description',
   'published_at', 'created_at', 'updated_at'],
  { cast: { status: 'product_status' } }));
parts.push(await dumpTable('product_variants',
  ['id', 'product_id', 'name', 'slug', 'hex_color', 'hex_color_secondary', 'finish', 'sku',
   'price_cents_override', 'stock_quantity', 'is_available', 'is_default', 'display_order',
   'created_at', 'updated_at']));
parts.push(await dumpTable('product_images',
  ['id', 'product_id', 'variant_id', 'storage_path', 'alt_text', 'width', 'height',
   'is_primary', 'display_order', 'created_at']));
parts.push(await dumpTable('orders',
  ['id', 'order_number', 'status', 'payment_status', 'email', 'customer_name', 'phone',
   'shipping_name', 'shipping_line1', 'shipping_line2', 'shipping_city', 'shipping_state',
   'shipping_postal_code', 'shipping_country', 'stripe_checkout_session_id',
   'stripe_payment_intent_id', 'stripe_customer_id', 'currency', 'subtotal_cents',
   'shipping_cents', 'tax_cents', 'discount_cents', 'total_cents', 'amount_refunded_cents',
   'tracking_number', 'tracking_url', 'admin_notes', 'oversold', 'stripe_session_raw',
   'created_at', 'updated_at', 'paid_at', 'fulfilled_at', 'cancelled_at', 'expires_at'],
  { cast: { status: 'order_status', payment_status: 'payment_status' } }));
parts.push(await dumpTable('order_items',
  ['id', 'order_id', 'product_id', 'variant_id', 'product_name', 'product_slug', 'variant_name',
   'variant_hex', 'sku', 'image_path', 'unit_price_cents', 'quantity', 'created_at']));
parts.push(await dumpTable('inventory_adjustments',
  ['id', 'variant_id', 'delta', 'reason', 'order_id', 'note', 'created_at'],
  { cast: { reason: 'stock_reason' } }));

// 3) settings (0001 inserts the default row; overwrite with local values)
const { rows: [s] } = await pool.query('select * from store_settings where id');
parts.push(`-- store_settings
update store_settings set
  currency = ${lit(s.currency)},
  flat_shipping_cents = ${lit(s.flat_shipping_cents)},
  free_shipping_threshold_cents = ${lit(s.free_shipping_threshold_cents)},
  allowed_shipping_countries = ${lit(s.allowed_shipping_countries)},
  announcement = ${lit(s.announcement)},
  checkout_enabled = ${lit(s.checkout_enabled)}
where id;\n`);

// 4) advance the order-number sequence past used values
const { rows: [seq] } = await pool.query(`select last_value from order_number_seq`);
parts.push(`select setval('order_number_seq', ${seq.last_value});\n`);

// 5) mark every canonical migration as applied so the app's runner skips them
parts.push(`-- migration bookkeeping
create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);
insert into schema_migrations (filename) values
  ('0001_init.sql'), ('0002_functions.sql'), ('0003_seed.sql'), ('0004_skincare_dummies.sql'),
  ('supabase_full_migration.sql')
on conflict do nothing;\n`);

parts.push('commit;');

const out = path.join(root, 'migrations', 'supabase_full_migration.sql');
fs.writeFileSync(out, parts.join('\n'));
console.log(`written: ${out}`);

const counts = await pool.query(`
  select 'categories' t, count(*) n from categories union all
  select 'products', count(*) from products union all
  select 'product_variants', count(*) from product_variants union all
  select 'orders', count(*) from orders union all
  select 'order_items', count(*) from order_items union all
  select 'inventory_adjustments', count(*) from inventory_adjustments
`);
console.table(counts.rows);
await pool.end();
