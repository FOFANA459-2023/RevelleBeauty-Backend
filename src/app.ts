import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type { Pool } from 'pg';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { UPLOADS_DIR } from './lib/storage.js';
import { globalLimiter, checkoutLimiter } from './middleware/rateLimit.js';
import { invalidateCatalog } from './lib/cache.js';
import type { NextFunction, Request, Response } from 'express';

/** Personal/sensitive responses: forbid any browser or intermediary caching. */
function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'private, no-store');
  next();
}

/** After any successful admin write, drop the public catalog cache. */
function invalidateOnWrite(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET') {
    res.on('finish', () => {
      if (res.statusCode < 400) invalidateCatalog();
    });
  }
  next();
}
import { requireAdmin } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { catalogRoutes } from './modules/catalog/catalog.routes.js';
import { checkoutRoutes } from './modules/checkout/checkout.routes.js';
import { customerAuthRoutes } from './modules/customers/customer.auth.routes.js';
import { accountRoutes } from './modules/customers/account.routes.js';
import { stripeWebhookRoutes } from './modules/webhooks/stripe.webhook.js';
import { adminProductRoutes } from './modules/admin/products.routes.js';
import { adminImageRoutes } from './modules/admin/images.routes.js';
import { adminCategoryRoutes } from './modules/admin/categories.routes.js';
import { adminOrderRoutes } from './modules/admin/orders.routes.js';

export function buildApp(pool: Pool): express.Express {
  const app = express();
  app.set('trust proxy', 1);

  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  // 1) WEBHOOK FIRST — express.raw before any JSON parser touches the stream.
  //    stripe.webhooks.constructEvent needs the exact bytes Stripe sent.
  app.use(
    '/api/webhooks/stripe',
    express.raw({ type: 'application/json', limit: '1mb' }),
    stripeWebhookRoutes(pool),
  );

  // 2) Everything else.
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '100kb' }));
  app.use(compression());

  // Local image storage (dev). In supabase mode these URLs are absolute.
  app.use('/uploads', express.static(UPLOADS_DIR, {
    maxAge: '365d',
    immutable: true,
    fallthrough: true,
  }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  const api = express.Router();
  api.use(globalLimiter);

  api.use(catalogRoutes(pool));
  api.use('/checkout', noStore); // order/session payloads are personal
  api.use('/checkout/session', checkoutLimiter);
  api.use(checkoutRoutes(pool));

  // Unified auth: customers AND admins sign in at /auth/login; the session's
  // role claim decides what it may reach. Personal data — never cacheable.
  api.use('/auth', noStore, customerAuthRoutes(pool));
  api.use('/account', noStore, accountRoutes(pool));

  // Admin: every route requires a role=admin session — there is no separate
  // admin login. Admin responses are sensitive (never cached); admin writes
  // drop the public catalog cache so storefront changes appear immediately.
  api.use('/admin', noStore, invalidateOnWrite);
  api.use('/admin', requireAdmin, adminProductRoutes(pool));
  api.use('/admin', requireAdmin, adminImageRoutes(pool));
  api.use('/admin', requireAdmin, adminCategoryRoutes(pool));
  api.use('/admin', requireAdmin, adminOrderRoutes(pool));

  app.use('/api', api);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
