import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import type { Pool } from 'pg';

/**
 * Protections added for taking payments: cross-site request refusal, the
 * Cloudflare-only origin lock, order confirmations visible only to their own
 * customer, and a payment in the wrong currency never counting as paid.
 */

let app: Express;
let pool: Pool;
let variantId = '';

const SHIPPING = {
  name: 'Amara Johnson', phone: '+1 555 123 4567', line1: '12 Rose Street', line2: null,
  city: 'Austin', state: 'TX', postalCode: '78701', country: 'US',
};

const cookieOf = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');

async function customer(email: string): Promise<string> {
  const reg = await request(app).post('/api/auth/register').send({ email, password: 'password123', name: 'Test Shopper' });
  return cookieOf(reg);
}

async function newOrder(cookie: string): Promise<{ sessionId: string; orderId: string }> {
  const res = await request(app).post('/api/checkout/session').set('Cookie', cookie)
    .send({ items: [{ variantId, quantity: 1 }], shipping: SHIPPING });
  expect(res.status).toBe(200);
  return { sessionId: res.body.sessionId, orderId: res.body.orderId };
}

beforeAll(async () => {
  const { getPool } = await import('../../src/db/pool.js');
  const { seedAdminUser } = await import('../../src/db/seed-admin.js');
  const { buildApp } = await import('../../src/app.js');
  pool = await getPool();
  await seedAdminUser(pool);
  app = buildApp(pool);
  const detail = await request(app).get('/api/products/creamy-matte-lipstick');
  variantId = detail.body.product.variants[0].id;
});

describe('cross-site request forgery', () => {
  const login = { email: 'nobody@test.local', password: 'wrong-password' };

  it('refuses a state-changing request from another site', async () => {
    const res = await request(app).post('/api/auth/login').set('Origin', 'https://evil.example').send(login);
    expect(res.status).toBe(403);
  });

  it('refuses a browser-flagged cross-site request, and an opaque null origin', async () => {
    expect((await request(app).post('/api/auth/login').set('Sec-Fetch-Site', 'cross-site').send(login)).status).toBe(403);
    expect((await request(app).post('/api/auth/login').set('Origin', 'null').send(login)).status).toBe(403);
  });

  it('falls back to the Referer when there is no Origin', async () => {
    const res = await request(app).post('/api/auth/login').set('Referer', 'https://evil.example/page').send(login);
    expect(res.status).toBe(403);
  });

  it('lets our own site through (and reads stay open)', async () => {
    const res = await request(app).post('/api/auth/login')
      .set('Origin', 'http://localhost:5173').set('Sec-Fetch-Site', 'same-origin').send(login);
    expect(res.status).toBe(401); // reached the handler: wrong password, not refused
    expect((await request(app).get('/api/products').set('Origin', 'https://evil.example')).status).toBe(200);
  });

  it('does not block Stripe webhooks, which are authenticated by signature', async () => {
    const res = await request(app).post('/api/webhooks/stripe')
      .set('Origin', 'https://evil.example').set('Content-Type', 'application/json').send('{}');
    expect(res.status).toBe(200);
  });
});

describe('origin lock (only the Cloudflare Worker may reach the API)', () => {
  const secret = 's'.repeat(40);
  let locked: Express;

  beforeAll(async () => {
    const { originLock } = await import('../../src/middleware/security.js');
    const { errorHandler } = await import('../../src/middleware/errorHandler.js');
    locked = express();
    locked.use(originLock(secret));
    locked.get('/api/health', (_req, res) => { res.json({ ok: true }); });
    locked.get('/api/products', (_req, res) => { res.json({ ok: true }); });
    locked.use(errorHandler);
  });

  it('refuses requests without the shared secret, or with a wrong one', async () => {
    expect((await request(locked).get('/api/products')).status).toBe(403);
    expect((await request(locked).get('/api/products').set('X-Origin-Auth', 'x'.repeat(40))).status).toBe(403);
    expect((await request(locked).get('/api/products').set('X-Origin-Auth', 'short')).status).toBe(403);
  });

  it('lets the Worker through, and keeps the health check open', async () => {
    expect((await request(locked).get('/api/products').set('X-Origin-Auth', secret)).status).toBe(200);
    expect((await request(locked).get('/api/health')).status).toBe(200);
  });
});

describe('order confirmations', () => {
  it("show an order only to the customer who placed it (or an admin)", async () => {
    const owner = await customer('owner@test.local');
    const other = await customer('other@test.local');
    const { sessionId } = await newOrder(owner);
    expect((await request(app).post('/api/checkout/mock-pay').send({ sessionId })).status).toBe(200);

    const url = `/api/checkout/session/${sessionId}`;
    expect((await request(app).get(url)).status).toBe(401);
    expect((await request(app).get(url).set('Cookie', other)).status).toBe(404);
    const mine = await request(app).get(url).set('Cookie', owner);
    expect(mine.status).toBe(200);
    expect(mine.body.status).toBe('paid');

    const login = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'test-admin-pass' });
    expect((await request(app).get(url).set('Cookie', cookieOf(login))).status).toBe(200);
  });
});

describe('payment verification', () => {
  it('a payment in a different currency than the order is held for review, never treated as paid in full', async () => {
    const { markOrderPaid } = await import('../../src/modules/checkout/checkout.service.js');
    const { orderId } = await newOrder(await customer('currency@test.local'));
    const { rows: [o] } = await pool.query(`select total_cents from orders where id = $1`, [orderId]);

    await markOrderPaid(pool, orderId, {
      paymentIntentId: 'pi_test_currency', email: null, customerName: null, phone: null, shipping: null,
      amountTotalCents: o.total_cents, currency: 'jpy', raw: { test: true },
    });

    const { rows: [after] } = await pool.query(`select status::text from orders where id = $1`, [orderId]);
    expect(after.status).toBe('needs_review');
  });

  it('the right amount in the right currency is paid', async () => {
    const { markOrderPaid } = await import('../../src/modules/checkout/checkout.service.js');
    const { orderId } = await newOrder(await customer('rightcurrency@test.local'));
    const { rows: [o] } = await pool.query(`select total_cents from orders where id = $1`, [orderId]);

    await markOrderPaid(pool, orderId, {
      paymentIntentId: 'pi_test_ok', email: null, customerName: null, phone: null, shipping: null,
      amountTotalCents: o.total_cents, currency: 'usd', raw: { test: true },
    });

    const { rows: [after] } = await pool.query(`select status::text from orders where id = $1`, [orderId]);
    expect(after.status).toBe('paid');
  });
});
