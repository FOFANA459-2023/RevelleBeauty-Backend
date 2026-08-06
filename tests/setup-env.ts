/**
 * Runs before each test file, BEFORE the app modules load — so these env
 * values win over anything in .env (dotenv never overrides existing vars).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = fs.readFileSync(path.resolve(here, '.test-db-url'), 'utf8').trim();

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = url;
process.env.STORAGE_DRIVER = 'local';
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync('test-admin-pass', 4);
process.env.ADMIN_JWT_SECRET = 'test-secret-test-secret-test-secret-0123456789';
// Ensure the mock (no-Stripe) path is exercised deterministically.
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
