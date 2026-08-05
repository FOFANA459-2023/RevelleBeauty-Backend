import { Router } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import { env, isDev, stripeEnabled } from '../../config/env.js';
import { badRequest, notFound } from '../../lib/errors.js';
import * as svc from './checkout.service.js';
import { validateCart } from './pricing.service.js';

// NO price field anywhere — .strict() rejects a request that includes one.
const cartItemSchema = z
  .object({
    variantId: z.string().uuid(),
    quantity: z.number().int().min(1).max(env.MAX_QTY_PER_LINE),
  })
  .strict();

const createSessionSchema = z
  .object({
    items: z.array(cartItemSchema).min(1).max(env.MAX_CART_LINES),
    email: z.string().email().optional(),
  })
  .strict();

const validateSchema = z
  .object({ items: z.array(cartItemSchema).min(0).max(env.MAX_CART_LINES) })
  .strict();

export function checkoutRoutes(pool: Pool): Router {
  const r = Router();

  r.post('/cart/validate', async (req, res) => {
    const body = validateSchema.parse(req.body);
    if (body.items.length === 0) {
      res.json({ lines: [], removed: [] });
      return;
    }
    res.json(await validateCart(pool, body.items));
  });

  r.post('/checkout/session', async (req, res) => {
    const body = createSessionSchema.parse(req.body);
    res.json(await svc.createCheckoutSession(pool, body.items, body.email));
  });

  r.get('/checkout/session/:sessionId', async (req, res) => {
    res.json(await svc.getOrderConfirmation(pool, req.params.sessionId));
  });

  // ---- Dev-only mock payment (no Stripe keys configured) ----
  if (isDev && !stripeEnabled) {
    r.post('/checkout/mock-pay', async (req, res) => {
      const body = z
        .object({
          sessionId: z.string().startsWith('mock_'),
          name: z.string().min(1).max(120).optional(),
          email: z.string().email().optional(),
        })
        .strict()
        .parse(req.body);

      const orderId = body.sessionId.slice('mock_'.length);
      const { rows } = await pool.query<{ id: string; total_cents: number }>(
        `select id, total_cents from orders where id = $1 and stripe_checkout_session_id = $2`,
        [orderId, body.sessionId],
      );
      if (!rows[0]) throw notFound('Order not found');

      await svc.markOrderPaid(pool, orderId, {
        paymentIntentId: `mock_pi_${orderId}`,
        email: body.email ?? 'test@revellebeauty.local',
        customerName: body.name ?? 'Test Customer',
        phone: null,
        shipping: {
          name: body.name ?? 'Test Customer',
          line1: '123 Test Street',
          line2: null,
          city: 'Testville',
          state: 'CA',
          postal_code: '90210',
          country: 'US',
        },
        amountTotalCents: rows[0].total_cents,
        raw: { mock: true, paidAt: new Date().toISOString() },
      });
      res.json({ ok: true });
    });
  } else if (!stripeEnabled) {
    r.post('/checkout/mock-pay', () => {
      throw badRequest('Mock payments are only available in development');
    });
  }

  return r;
}
