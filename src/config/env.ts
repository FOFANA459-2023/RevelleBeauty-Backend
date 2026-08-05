import 'dotenv/config';
import { z } from 'zod';

/**
 * Fail-fast env validation. Boot dies loudly on a bad config rather than
 * failing at 2am on the first real order.
 *
 * Local-dev posture: DATABASE_URL and Stripe keys are OPTIONAL in development.
 * - No DATABASE_URL  -> embedded Postgres is booted automatically (dev only).
 * - No STRIPE keys   -> checkout runs in mock mode (dev only).
 * In production both are required — enforced below.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('debug'),

  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean)),

  /** Postgres connection string. Later: the Supabase pooler URL. */
  DATABASE_URL: z.string().optional(),
  /** Port for the embedded dev database. */
  EMBEDDED_PG_PORT: z.coerce.number().int().positive().default(5544),

  /** 'local' serves from backend/uploads; 'supabase' uses Supabase Storage. */
  STORAGE_DRIVER: z.enum(['local', 'supabase']).default('local'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('product-images'),

  STRIPE_SECRET_KEY: z.string().startsWith('sk_').optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),
  STRIPE_CURRENCY: z.string().length(3).default('usd'),

  ADMIN_PASSWORD_HASH: z.string().startsWith('$2').optional(),
  /** Dev fallback when no hash is set. NEVER used in production. */
  ADMIN_DEV_PASSWORD: z.string().default('revelle-admin'),
  ADMIN_JWT_SECRET: z.string().min(32).optional(),
  ADMIN_SESSION_HOURS: z.coerce.number().int().min(1).max(168).default(12),

  MAX_CART_LINES: z.coerce.number().int().positive().default(20),
  MAX_QTY_PER_LINE: z.coerce.number().int().positive().default(10),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';

/** True when real Stripe is configured; otherwise dev mock checkout is used. */
export const stripeEnabled = Boolean(env.STRIPE_SECRET_KEY);

if (isProd) {
  const missing: string[] = [];
  if (!env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
  if (!env.STRIPE_WEBHOOK_SECRET) missing.push('STRIPE_WEBHOOK_SECRET');
  if (!env.ADMIN_PASSWORD_HASH) missing.push('ADMIN_PASSWORD_HASH');
  if (!env.ADMIN_JWT_SECRET) missing.push('ADMIN_JWT_SECRET');
  if (missing.length) {
    console.error(`Missing required production env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

/** JWT secret: required in prod (checked above); stable dev default otherwise. */
export const adminJwtSecret =
  env.ADMIN_JWT_SECRET ?? 'dev-only-secret-do-not-use-in-production-0123456789';
