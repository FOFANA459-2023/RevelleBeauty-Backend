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
  /** The database's CA certificate (PEM text or file path): turns on full TLS verification. */
  DATABASE_SSL_CA: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  /** Port for the embedded dev database. */
  EMBEDDED_PG_PORT: z.coerce.number().int().positive().default(5544),

  /** 'local' serves from backend/uploads; 'supabase' uses Supabase Storage. */
  STORAGE_DRIVER: z.enum(['local', 'supabase']).default('local'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('product-images'),

  // An empty value means "not set" (tests blank them so .env can't refill them).
  // A full secret key (sk_) or a permission-scoped restricted key (rk_) —
  // the latter is preferred: it can create Checkout Sessions but not move
  // money out of the account.
  STRIPE_SECRET_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().regex(/^(sk|rk)_(test|live)_/, 'a Stripe secret (sk_) or restricted (rk_) key').optional(),
  ),
  STRIPE_WEBHOOK_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().startsWith('whsec_').optional()),
  STRIPE_CURRENCY: z.string().length(3).default('usd'),

  /** The business owner's admin login (the client). */
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD_HASH: z.string().startsWith('$2').optional(),
  /**
   * Plaintext alternative to ADMIN_PASSWORD_HASH — hashed at boot when the
   * admin user is seeded. Preferred on servers: bcrypt hashes contain '$',
   * which docker-compose env files interpolate and silently corrupt.
   */
  ADMIN_PASSWORD: z.string().min(8).optional(),
  /** Dev fallback when no hash/password is set. NEVER used in production. */
  ADMIN_DEV_PASSWORD: z.string().default('revelle-admin'),
  /**
   * Optional second admin: the developer who maintains the site. Seeded at
   * boot exactly like the owner's account; remove both lines to revoke.
   */
  DEVELOPER_ADMIN_EMAIL: z.preprocess((v) => (v === '' ? undefined : v), z.string().email().optional()),
  DEVELOPER_ADMIN_PASSWORD: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(8).optional()),
  ADMIN_JWT_SECRET: z.string().min(32).optional(),
  ADMIN_SESSION_HOURS: z.coerce.number().int().min(1).max(168).default(12),

  /**
   * Outbound email (password resets).
   * 'console' logs the email instead of sending — dev/test default.
   * 'resend'  sends via the Resend HTTPS API (RESEND_API_KEY). Works on
   *           Oracle Cloud, which blocks outbound SMTP port 25 — HTTPS is
   *           never blocked.
   * 'smtp'    sends via SMTP submission (port 587/465 — open on Oracle
   *           Cloud; only port 25 is blocked). E.g. Gmail app password.
   */
  MAIL_DRIVER: z.enum(['console', 'resend', 'smtp']).default('console'),
  MAIL_FROM: z.string().default('Revelle Beauty <onboarding@resend.dev>'),
  /** Where customer replies go (the business inbox), whichever account sends. */
  MAIL_REPLY_TO: z.preprocess((v) => (v === '' ? undefined : v), z.string().email().optional()),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** true = implicit TLS (port 465); false = STARTTLS (port 587). */
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(60),

  /** Where new-order emails go. Private: never sent to the browser. */
  STORE_ORDER_EMAIL: z.string().email().optional(),
  /**
   * The store's WhatsApp number in international form (+81 70 1234 5678).
   * Public: customers get a "message us" button with it.
   */
  STORE_WHATSAPP: z
    .string()
    .optional()
    .transform((v) => (v ? v.replace(/[^\d]/g, '') : undefined))
    .pipe(z.string().regex(/^\d{8,15}$/, 'international number, 8-15 digits').optional()),
  /**
   * How new-order WhatsApp messages reach the store.
   * 'none'      — logged only (the store still gets the email).
   * 'callmebot' — CallMeBot's free API, which messages your own number once
   *               you have activated it and received an API key.
   */
  WHATSAPP_DRIVER: z.enum(['none', 'callmebot']).default('none'),
  CALLMEBOT_API_KEY: z.string().optional(),

  /**
   * Shared secret the Cloudflare Worker sends on every proxied request
   * (X-Origin-Auth). When set, requests without it are refused, so nobody
   * can reach the API around Cloudflare. Set the same value as a Worker
   * secret: `npx wrangler secret put ORIGIN_SHARED_SECRET`.
   */
  ORIGIN_SHARED_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(32).optional()),

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

/** 'live' or 'test' for a secret (sk_) or restricted (rk_) Stripe key; null when unset. */
export function stripeKeyMode(key: string | undefined): 'live' | 'test' | null {
  const m = key?.match(/^(?:sk|rk)_(live|test)_/);
  return m ? (m[1] as 'live' | 'test') : null;
}

/** True when real Stripe is configured; otherwise dev mock checkout is used. */
export const stripeEnabled = Boolean(env.STRIPE_SECRET_KEY);

if (isProd) {
  // Fatal: without these the server is either broken or insecure (a default
  // JWT secret in production would let anyone mint an admin session).
  const missing: string[] = [];
  if (!env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!env.ADMIN_EMAIL) missing.push('ADMIN_EMAIL');
  if (!env.ADMIN_PASSWORD_HASH && !env.ADMIN_PASSWORD)
    missing.push('ADMIN_PASSWORD (or ADMIN_PASSWORD_HASH)');
  if (!env.ADMIN_JWT_SECRET) missing.push('ADMIN_JWT_SECRET');
  if (env.DEVELOPER_ADMIN_EMAIL && !env.DEVELOPER_ADMIN_PASSWORD) missing.push('DEVELOPER_ADMIN_PASSWORD');
  if (missing.length) {
    console.error(`Missing required production env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  // Fatal: an explicitly chosen mail driver missing its credentials is a
  // misconfiguration, not a soft launch.
  if (env.MAIL_DRIVER === 'resend' && !env.RESEND_API_KEY) {
    console.error('MAIL_DRIVER=resend requires RESEND_API_KEY');
    process.exit(1);
  }
  if (env.MAIL_DRIVER === 'smtp' && (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS)) {
    console.error('MAIL_DRIVER=smtp requires SMTP_HOST, SMTP_USER and SMTP_PASS');
    process.exit(1);
  }
  if (env.WHATSAPP_DRIVER === 'callmebot' && (!env.CALLMEBOT_API_KEY || !env.STORE_WHATSAPP)) {
    console.error('WHATSAPP_DRIVER=callmebot requires CALLMEBOT_API_KEY and STORE_WHATSAPP');
    process.exit(1);
  }
  if (!env.STORE_ORDER_EMAIL) {
    console.error('[warn] STORE_ORDER_EMAIL is not set — new orders will not be emailed to the store.');
  }

  // Non-fatal: password reset simply logs the link server-side until a real
  // mail driver is configured.
  if (env.MAIL_DRIVER === 'console') {
    console.error(
      '[warn] MAIL_DRIVER=console — password reset emails are only logged, not sent. ' +
        'Set MAIL_DRIVER=resend (RESEND_API_KEY) or smtp to deliver them.',
    );
  }

  // Fatal: taking real money without the webhook means a customer who pays
  // and closes the tab before the redirect is charged while their order
  // silently expires. Live keys therefore require the webhook secret.
  if (stripeKeyMode(env.STRIPE_SECRET_KEY) === 'live' && !env.STRIPE_WEBHOOK_SECRET) {
    console.error('A live STRIPE_SECRET_KEY requires STRIPE_WEBHOOK_SECRET (payments would be lost).');
    process.exit(1);
  }
  if (stripeKeyMode(env.STRIPE_SECRET_KEY) === 'test') {
    console.error('[warn] STRIPE_SECRET_KEY is a TEST key — no real payments will be taken.');
  }
  if (!env.ORIGIN_SHARED_SECRET) {
    console.error(
      '[warn] ORIGIN_SHARED_SECRET is not set — the API accepts requests that bypass Cloudflare ' +
        '(and their spoofed client IPs). Set it here and as a Worker secret.',
    );
  }

  // Non-fatal: the storefront is perfectly useful for browsing before
  // payments are wired. Checkout returns a clear 503 until these are set,
  // so a soft launch does not require a Stripe account first.
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    console.error(
      '[warn] Stripe is not configured — checkout will return 503. ' +
        'Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to accept payments.',
    );
  }
}

/** Every email that signs in as an admin (owner first, then the developer). */
export const adminEmails = (): string[] =>
  [env.ADMIN_EMAIL, env.DEVELOPER_ADMIN_EMAIL]
    .filter((e): e is string => Boolean(e))
    .map((e) => e.trim().toLowerCase());

/** JWT secret: required in prod (checked above); stable dev default otherwise. */
export const adminJwtSecret =
  env.ADMIN_JWT_SECRET ?? 'dev-only-secret-do-not-use-in-production-0123456789';
