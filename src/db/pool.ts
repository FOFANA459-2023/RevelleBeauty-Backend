import fs from 'node:fs';
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
    // Remote DB: keep connections warm. The pg default drops idle clients
    // after 10s, so every quiet minute made the next request pay a fresh
    // TLS + auth handshake to the pooler. Hold them for 10 minutes instead.
    idleTimeoutMillis: 10 * 60_000,
    keepAlive: true,
    connectionTimeoutMillis: 10_000,
    ssl: tlsFor(connectionString),
  });

  pool.on('error', (err) => logger.error({ err }, 'idle postgres client error'));
  return pool;
}

/**
 * TLS to the database. Supabase (direct .co and pooler .com hosts) requires
 * it; local does not. Supabase signs with its own CA, so the certificate can
 * only be verified against that CA: set DATABASE_SSL_CA to the certificate
 * (PEM text, or a path to the .crt from Supabase → Database → SSL). Without
 * it the connection is encrypted but unverified — open to impersonation by
 * anyone on the network path — and production says so at boot.
 */
export function tlsFor(connectionString: string): pg.PoolConfig['ssl'] {
  const ca = loadCa(env.DATABASE_SSL_CA);
  if (ca) return { ca, rejectUnauthorized: true };
  if (/supabase\.(co|com)/.test(connectionString)) {
    if (env.NODE_ENV === 'production') {
      logger.warn('DATABASE_SSL_CA is not set: the database certificate is NOT verified');
    }
    return { rejectUnauthorized: false };
  }
  return undefined;
}

function loadCa(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.includes('-----BEGIN CERTIFICATE-----')) return value.replace(/\\n/g, '\n');
  return fs.readFileSync(value, 'utf8');
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
