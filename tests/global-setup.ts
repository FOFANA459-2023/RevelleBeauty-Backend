/**
 * Boots a throwaway embedded Postgres (fresh data dir, own port), applies
 * every migration, and hands the connection string to test workers via a
 * temp file (env set here does not reliably reach worker processes).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(here, '../.pgdata-test');
const URL_FILE = path.resolve(here, '.test-db-url');
const PORT = 5599;

export default async function setup(): Promise<() => Promise<void>> {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');

  fs.rmSync(DATA_DIR, { recursive: true, force: true });

  const epg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'revelle_test',
    password: 'revelle_test',
    port: PORT,
    persistent: false,
  });

  await epg.initialise();
  await epg.start();
  await epg.createDatabase('revelle_test');

  const url = `postgresql://revelle_test:revelle_test@localhost:${PORT}/revelle_test`;

  // Migrations, once for the whole run.
  const pg = await import('pg');
  const pool = new pg.default.Pool({ connectionString: url });
  const MIGRATIONS = path.resolve(here, '../migrations');
  await pool.query(`create table if not exists schema_migrations (
    filename text primary key, applied_at timestamptz not null default now())`);
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
    await pool.query(sql);
    await pool.query('insert into schema_migrations (filename) values ($1)', [file]);
  }
  await pool.end();

  fs.writeFileSync(URL_FILE, url);

  return async () => {
    fs.rmSync(URL_FILE, { force: true });
    await epg.stop();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  };
}
