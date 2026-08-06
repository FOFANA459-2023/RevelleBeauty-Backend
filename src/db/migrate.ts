import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';
import { logger } from '../lib/logger.js';
import { MIGRATIONS_DIR } from '../lib/paths.js';

/**
 * Minimal forward-only migration runner. Applied files are recorded in
 * schema_migrations; each file runs once, in filename order, in a transaction.
 * The same .sql files can be pasted into the Supabase SQL Editor unchanged.
 */
export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )`);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query<{ filename: string }>(
    'select filename from schema_migrations',
  );
  const applied = new Set(rows.map((r) => r.filename));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (filename) values ($1)', [file]);
      await client.query('commit');
      logger.info(`migration applied: ${file}`);
    } catch (err) {
      await client.query('rollback');
      logger.error({ err }, `migration FAILED: ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }
}
