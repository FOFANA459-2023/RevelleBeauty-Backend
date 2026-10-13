/**
 * Clones the production database into the local embedded Postgres
 * (backend/.pgdata) and mirrors every referenced image into backend/uploads,
 * so local dev and testing never read or write production.
 *
 * - Source: PROD_DATABASE_URL from backend/.env (read-only: SELECTs only).
 * - Target: a fresh embedded Postgres. An existing .pgdata is moved aside to
 *   .pgdata-backup-<timestamp>, never deleted.
 * - Schema comes from the same migrations the app runs; then every table is
 *   copied row-for-row (original ids) with triggers suspended, and sequences
 *   are set to production's values.
 * - Images: product, category, and order-snapshot paths are downloaded from
 *   the public Supabase bucket, so STORAGE_DRIVER=local serves them.
 *
 * The copy contains real customer data (emails, addresses, password hashes).
 * It stays on this machine: .pgdata* and uploads/ are gitignored.
 *
 * Stop the dev backend first (it holds .pgdata open), then from backend/:
 *   node scripts/clone-prod-db.mjs
 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const env = {};
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2];
}
const PROD_URL = process.env.PROD_DATABASE_URL ?? env.PROD_DATABASE_URL;
const SUPABASE_URL = (env.SUPABASE_URL ?? '').replace(/\/$/, '');
const BUCKET = env.SUPABASE_STORAGE_BUCKET || 'product-images';
const PORT = Number(env.EMBEDDED_PG_PORT || 5544);
if (!PROD_URL) throw new Error('PROD_DATABASE_URL missing from backend/.env');
if (!SUPABASE_URL) throw new Error('SUPABASE_URL missing from backend/.env');

const dataDir = path.join(root, '.pgdata');
const uploadsDir = path.join(root, 'uploads');
const LOCAL_URL = `postgresql://revelle:revelle@localhost:${PORT}/revelle`;

const prod = new pg.Pool({ connectionString: PROD_URL, ssl: { rejectUnauthorized: false }, max: 2 });

async function startFreshEmbedded() {
  if (fs.existsSync(dataDir)) {
    const backup = `${dataDir}-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.renameSync(dataDir, backup);
    console.log(`existing .pgdata moved to ${path.basename(backup)}`);
  }
  const epg = new EmbeddedPostgres({
    databaseDir: dataDir, user: 'revelle', password: 'revelle', port: PORT, persistent: true,
    // Match Supabase. Windows otherwise defaults to WIN1252, which rejects
    // non-Latin text that production already holds.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });
  await epg.initialise();
  await epg.start();
  await epg.createDatabase('revelle');
  return epg;
}

/** Same forward-only runner as src/db/migrate.ts. */
async function migrate(local) {
  await local.query(`create table if not exists schema_migrations (
    filename text primary key, applied_at timestamptz not null default now())`);
  const dir = path.join(root, 'migrations');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    // A one-time data snapshot used to bootstrap Supabase — its schema is
    // already covered by the numbered files, and its rows collide with the
    // seeds. Rows come from production below anyway.
    if (file === 'supabase_full_migration.sql') {
      await local.query('insert into schema_migrations (filename) values ($1)', [file]);
      continue;
    }
    const client = await local.connect();
    try {
      await client.query('begin');
      await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await client.query('insert into schema_migrations (filename) values ($1)', [file]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw new Error(`migration ${file} failed locally: ${err.message}`);
    } finally {
      client.release();
    }
  }
}

async function tableColumns(db, table) {
  const { rows } = await db.query(
    `select column_name, data_type, is_generated, is_identity
       from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by ordinal_position`,
    [table],
  );
  return rows;
}

async function copyTables(local) {
  const listTables = async (db) =>
    (await db.query(`select table_name from information_schema.tables
                      where table_schema = 'public' and table_type = 'BASE TABLE'
                      order by table_name`)).rows.map((r) => r.table_name);
  const prodTables = await listTables(prod);
  const localTables = await listTables(local);
  const missing = prodTables.filter((t) => !localTables.includes(t));
  if (missing.length) throw new Error(`tables in prod but not local schema: ${missing.join(', ')}`);

  const client = await local.connect();
  try {
    await client.query('begin');
    // Suspend FK checks and triggers (updated_at, notifications) so rows land verbatim.
    await client.query(`set local session_replication_role = replica`);
    await client.query(`truncate ${localTables.map((t) => `"${t}"`).join(', ')} cascade`);

    for (const table of prodTables) {
      const cols = (await tableColumns(prod, table)).filter((c) => c.is_generated !== 'ALWAYS');
      const localCols = new Set((await tableColumns(local, table)).map((c) => c.column_name));
      const drift = cols.filter((c) => !localCols.has(c.column_name));
      if (drift.length) {
        throw new Error(`${table}: columns missing locally: ${drift.map((c) => c.column_name).join(', ')}`);
      }
      const names = cols.map((c) => `"${c.column_name}"`).join(', ');
      const { rows } = await prod.query(`select ${names} from "${table}"`);
      const overriding = cols.some((c) => c.is_identity === 'YES') ? 'overriding system value' : '';
      const BATCH = 200;
      for (let i = 0; i < rows.length; i += BATCH) {
        const params = [];
        const tuples = rows.slice(i, i + BATCH).map((row) => {
          const slots = cols.map((c) => {
            const v = row[c.column_name];
            params.push(v !== null && (c.data_type === 'json' || c.data_type === 'jsonb') ? JSON.stringify(v) : v);
            return `$${params.length}`;
          });
          return `(${slots.join(', ')})`;
        });
        await client.query(`insert into "${table}" (${names}) ${overriding} values ${tuples.join(', ')}`, params);
      }
      console.log(`  ${table}: ${rows.length}`);
    }

    const { rows: seqs } = await prod.query(
      `select schemaname, sequencename, last_value from pg_sequences where schemaname = 'public'`,
    );
    for (const s of seqs) {
      if (s.last_value == null) continue;
      await client.query(`select setval($1, $2, true)`, [`public.${s.sequencename}`, s.last_value]);
    }
    await client.query('commit');
    console.log(`  sequences: ${seqs.length}`);
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function mirrorImages() {
  const { rows } = await prod.query(`
    select storage_path as p from product_images
    union select image_path from order_items where image_path is not null
    union select hero_image_path from categories where hero_image_path is not null`);
  let fetched = 0;
  let present = 0;
  const failed = [];
  for (const { p } of rows) {
    if (/^https?:/.test(p)) continue;
    const dest = path.join(uploadsDir, p);
    if (fs.existsSync(dest)) { present++; continue; }
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${p}`);
    if (!res.ok) { failed.push(`${p} (${res.status})`); continue; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    fetched++;
  }
  console.log(`images: ${fetched} downloaded, ${present} already local`);
  if (failed.length) console.log(`  not in bucket (skipped): ${failed.join(', ')}`);
}

async function main() {
  console.log('starting fresh embedded postgres…');
  const epg = await startFreshEmbedded();
  const local = new pg.Pool({ connectionString: LOCAL_URL, max: 2 });
  try {
    await migrate(local);
    console.log('copying production tables…');
    await copyTables(local);
    await mirrorImages();
    console.log(`\nlocal copy ready: ${LOCAL_URL}`);
  } finally {
    await local.end();
    await prod.end();
    await epg.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
