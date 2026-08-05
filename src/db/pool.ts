import pg from 'pg';
import { env, isDev } from '../config/env.js';
import { logger } from '../lib/logger.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let embedded: { stop: () => Promise<void> } | null = null;

/**
 * Returns the shared pool. In dev with no DATABASE_URL, boots an embedded
 * PostgreSQL (real binaries, data in backend/.pgdata) so no local install
 * or Docker is needed. When Supabase credentials arrive, set DATABASE_URL
 * and this path is skipped entirely.
 */
export async function getPool(): Promise<pg.Pool> {
  if (pool) return pool;

  let connectionString = env.DATABASE_URL;

  if (!connectionString) {
    if (!isDev) throw new Error('DATABASE_URL is required outside development');
    connectionString = await startEmbeddedPostgres();
  }

  pool = new Pool({
    connectionString,
    max: 10,
    // Supabase requires TLS; local does not. sslmode in the URL wins if present.
    ssl: connectionString.includes('supabase.co')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  pool.on('error', (err) => logger.error({ err }, 'idle postgres client error'));
  return pool;
}

async function startEmbeddedPostgres(): Promise<string> {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const here = path.dirname(fileURLToPath(import.meta.url));
  const dataDir = path.resolve(here, '../../.pgdata');

  const epg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'revelle',
    password: 'revelle',
    port: env.EMBEDDED_PG_PORT,
    persistent: true,
  });

  const fs = await import('node:fs');
  const isInitialized = fs.existsSync(path.join(dataDir, 'PG_VERSION'));

  if (!isInitialized) {
    logger.info('initializing embedded postgres (first run downloads binaries)...');
    await epg.initialise();
  }
  await epg.start();

  const dbName = 'revelle';
  if (!isInitialized) {
    await epg.createDatabase(dbName);
  }

  embedded = epg;
  logger.info(`embedded postgres running on port ${env.EMBEDDED_PG_PORT}`);
  return `postgresql://revelle:revelle@localhost:${env.EMBEDDED_PG_PORT}/${dbName}`;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  if (embedded) {
    await embedded.stop();
    embedded = null;
  }
}
