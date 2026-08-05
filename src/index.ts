import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { getPool, closePool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { buildApp } from './app.js';

const pool = await getPool();
await runMigrations(pool);

const app = buildApp(pool);
const server = app.listen(env.PORT, () => {
  logger.info(`revelle api listening on http://localhost:${env.PORT}`);
});

// Hourly: expire stale pending orders.
const expiryTimer = setInterval(async () => {
  try {
    const { rows } = await pool.query<{ expire_stale_orders: number }>(
      'select expire_stale_orders()',
    );
    const n = rows[0]?.expire_stale_orders ?? 0;
    if (n > 0) logger.info(`expired ${n} stale pending orders`);
  } catch (err) {
    logger.error({ err }, 'expire_stale_orders failed');
  }
}, 60 * 60 * 1000);

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — shutting down`);
  clearInterval(expiryTimer);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  // Hard exit if close hangs.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
