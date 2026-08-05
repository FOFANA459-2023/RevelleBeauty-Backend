import { getPool, closePool } from './pool.js';
import { runMigrations } from './migrate.js';

const pool = await getPool();
await runMigrations(pool);
await closePool();
console.log('migrations complete');
