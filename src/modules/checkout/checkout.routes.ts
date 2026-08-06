import { Router } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import { env, isProd, stripeEnabled } from '../../config/env.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { customerId, requireCustomer } from '../../middleware/requireCustomer.js';
import * as svc from './checkout.service.js';
import { validateCart } from './pricing.service.js';

// NO price field anywhere — .strict() rejects a request that includes one.
const cartItemSchema = z
  .object({
    variantId: z.string().uuid(),
    quantity: z.number().int().min(1).max(env.MAX_QTY_PER_LINE),
  })
  .strict();

const shippingSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(5).max(30),
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).nullish(),
    city: z.string().trim().min(1).max(100),
    state: z.string().trim().min(1).max(100),
    postalCode: z.string().trim().min(1).max(20),
    country: z.string().length(2).default('US'),
  })
  .strict();

const createSessionSchema = z
  .object({
    items: z.array(cartItemSchema).min(1).max(env.MAX_CART_LINES),
    shipping: shippingSchema,
    saveAsDefault: z.boolean().optional(),
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

  // Login required: name/phone/address come from the form, email from the session.
  r.post('/checkout/session', requireCustomer, async (req, res) => {
    const body = createSessionSchema.parse(req.body);
    const { rows } = await pool.query<{ id: string; email: string }>(
      `select id, email from customers where id = $1`,
      [customerId(req)],
    );
    if (!rows[0]) throw badRequest('Account not found');

    if (body.saveAsDefault) {
      await pool.query(
        `update customers set phone = $2, addr_line1 = $3, addr_line2 = $4,
                addr_city = $5, addr_state = $6, addr_postal_code = $7, addr_country = $8
          where id = $1`,
        [
          rows[0].id, body.shipping.phone, body.shipping.line1, body.shipping.line2 ?? null,
          body.shipping.city, body.shipping.state, body.shipping.postalCode, body.shipping.country,
        ],
      );
    }

    res.json(
      await svc.createCheckoutSession(pool, body.items, rows[0], {
        ...body.shipping,
        line2: body.shipping.line2 ?? null,
      }),
    );
  });

  r.get('/checkout/session/:sessionId', async (req, res) => {
    res.json(await svc.getOrderConfirmation(pool, req.params.sessionId));
  });

  // ---- Dev-only mock payment (no Stripe keys configured) ----
  // Mock payments exist only outside production (dev + test).
  if (!isProd && !stripeEnabled) {
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

      // Shipping/name/email stay null here — the order already carries the
      // address collected at checkout; mark_order_paid coalesces (order wins).
      await svc.markOrderPaid(pool, orderId, {
        paymentIntentId: `mock_pi_${orderId}`,
        email: body.email ?? null,
        customerName: body.name ?? null,
        phone: null,
        shipping: null,
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
