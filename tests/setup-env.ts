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
process.env.DEVELOPER_ADMIN_EMAIL = 'dev@test.local';
process.env.DEVELOPER_ADMIN_PASSWORD = 'test-dev-pass';
process.env.ADMIN_JWT_SECRET = 'test-secret-test-secret-test-secret-0123456789';
// Ensure the mock (no-Stripe) path is exercised deterministically. Blanked,
// not deleted: dotenv refills a deleted variable from a developer's .env, and
// the suite would then call Stripe with their real test key.
process.env.STRIPE_SECRET_KEY = '';
process.env.STRIPE_WEBHOOK_SECRET = '';
// Same for the origin lock: tests call the API directly, not via the Worker.
process.env.ORIGIN_SHARED_SECRET = '';
// The site's address decides which origins the CSRF guard accepts.
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.CORS_ORIGINS = 'http://localhost:5173';
// New-order notifications go to test addresses (captured, never sent).
process.env.STORE_ORDER_EMAIL = 'orders@test.local';
process.env.STORE_WHATSAPP = '+1 555 010 0000';
process.env.WHATSAPP_DRIVER = 'none';
