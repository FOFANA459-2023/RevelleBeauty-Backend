import bcrypt from 'bcryptjs';
import type { Pool } from 'pg';
import { env, isProd } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Upserts the admin account from env at boot. The env vars are the source of
 * truth for the admin credential: change them and restart to rotate it.
 *
 * ADMIN_PASSWORD (plaintext, hashed here) is preferred over
 * ADMIN_PASSWORD_HASH because bcrypt hashes contain '$', which docker-compose
 * env files interpolate as variables and silently corrupt.
 */
export async function seedAdminUser(pool: Pool): Promise<void> {
  const email = env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) {
    logger.warn('ADMIN_EMAIL not set — no admin account seeded');
    return;
  }

  let hash: string | null = null;
  if (env.ADMIN_PASSWORD) hash = await bcrypt.hash(env.ADMIN_PASSWORD, 12);
  else if (env.ADMIN_PASSWORD_HASH) hash = env.ADMIN_PASSWORD_HASH;
  else if (!isProd) hash = await bcrypt.hash(env.ADMIN_DEV_PASSWORD, 12);

  if (!hash) {
    logger.warn('No ADMIN_PASSWORD or ADMIN_PASSWORD_HASH set — admin not seeded');
    return;
  }

  await pool.query(
    `insert into customers (email, password_hash, name, role)
     values ($1, $2, 'Revelle Admin', 'admin')
     on conflict (email) do update
       set role = 'admin', password_hash = excluded.password_hash`,
    [email, hash],
  );
  logger.info(`admin account ready: ${email}`);
}
