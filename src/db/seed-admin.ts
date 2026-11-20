import bcrypt from 'bcryptjs';
import type { Pool } from 'pg';
import { env, isProd } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Upserts the admin accounts from env at boot. The env vars are the source of
 * truth for admin credentials: change them and restart to rotate a password.
 *
 *   ADMIN_EMAIL / ADMIN_PASSWORD                       the business owner
 *   DEVELOPER_ADMIN_EMAIL / DEVELOPER_ADMIN_PASSWORD   the developer (optional)
 *
 * ADMIN_PASSWORD (plaintext, hashed here) is preferred over
 * ADMIN_PASSWORD_HASH because bcrypt hashes contain '$', which docker-compose
 * env files interpolate as variables and silently corrupt.
 */
export async function seedAdminUser(pool: Pool): Promise<void> {
  const owner = env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!owner) {
    logger.warn('ADMIN_EMAIL not set — no admin account seeded');
  } else {
    let hash: string | null = null;
    if (env.ADMIN_PASSWORD) hash = await bcrypt.hash(env.ADMIN_PASSWORD, 12);
    else if (env.ADMIN_PASSWORD_HASH) hash = env.ADMIN_PASSWORD_HASH;
    else if (!isProd) hash = await bcrypt.hash(env.ADMIN_DEV_PASSWORD, 12);

    if (hash) await upsertAdmin(pool, owner, hash, 'Revelle Beauty');
    else logger.warn('No ADMIN_PASSWORD or ADMIN_PASSWORD_HASH set — admin not seeded');
  }

  const developer = env.DEVELOPER_ADMIN_EMAIL?.trim().toLowerCase();
  if (developer && env.DEVELOPER_ADMIN_PASSWORD && developer !== owner) {
    await upsertAdmin(pool, developer, await bcrypt.hash(env.DEVELOPER_ADMIN_PASSWORD, 12), 'Developer');
  }
}

async function upsertAdmin(pool: Pool, email: string, hash: string, name: string): Promise<void> {
  await pool.query(
    `insert into customers (email, password_hash, name, role)
     values ($1, $2, $3, 'admin')
     on conflict (email) do update
       set role = 'admin', password_hash = excluded.password_hash`,
    [email, hash, name],
  );
  logger.info(`admin account ready: ${email}`);
}
