import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

/**
 * The money path, end to end against a real Postgres:
 * register -> gated checkout -> mock pay -> stock decrement -> tracking
 * pipeline -> customer delivery confirmation -> admin sees it.
 */

let app: Express;
let customerCookie: string;
let adminCookie: string;
let variantId = '';
let sessionId = '';
let orderId = '';

const SHIPPING = {
  name: 'Test Runner',
  phone: '+15550001111',
  line1: '1 Integration Way',
  line2: null,
  city: 'Testville',
  state: 'CA',
  postalCode: '90001',
  country: 'US',
};

function cookieOf(res: request.Response): string {
  return (res.headers['set-cookie'] as unknown as string[])
    .map((c) => c.split(';')[0])
    .join('; ');
}

beforeAll(async () => {
  const { getPool } = await import('../../src/db/pool.js');
  const { seedAdminUser } = await import('../../src/db/seed-admin.js');
  const { buildApp } = await import('../../src/app.js');
  const pool = await getPool();
  await seedAdminUser(pool);
  app = buildApp(pool);
});

describe('order lifecycle', () => {
  it('rejects checkout without a login', async () => {
    const res = await request(app)
      .post('/api/checkout/session')
      .send({ items: [{ variantId: '00000000-0000-0000-0000-000000000000', quantity: 1 }], shipping: SHIPPING });
    expect(res.status).toBe(401);
  });

  it('registers a customer and starts a session', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'runner@test.local',
      password: 'password123',
      name: 'Test Runner',
    });
    expect(res.status).toBe(201);
    expect(res.body.customer.email).toBe('runner@test.local');
    customerCookie = cookieOf(res);
  });

  it('rejects duplicate registration', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'runner@test.local',
      password: 'password456',
      name: 'Imposter',
    });
    expect(res.status).toBe(409);
  });

  it('SECURITY: strips price fields from checkout via strict schema', async () => {
    const detail = await request(app).get('/api/products/high-shine-lip-oil');
    variantId = detail.body.product.variants[2].id;

    const res = await request(app)
      .post('/api/checkout/session')
      .set('Cookie', customerCookie)
      .send({
        items: [{ variantId, quantity: 1, price: 1 }],
        shipping: SHIPPING,
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('creates a pending order with the shipping address and session email', async () => {
    const res = await request(app)
      .post('/api/checkout/session')
      .set('Cookie', customerCookie)
      .send({ items: [{ variantId, quantity: 2 }], shipping: SHIPPING });
    expect(res.status).toBe(200);
    expect(res.body.orderNumber).toMatch(/^RB-\d+$/);
    expect(res.body.totals.subtotalCents).toBe(4400);
    sessionId = res.body.sessionId;
    orderId = res.body.orderId;
  });

  it('mock payment marks the order paid and decrements stock exactly once', async () => {
    const before = await request(app).get('/api/products/high-shine-lip-oil');
    const stockBefore = before.body.product.variants.find(
      (v: { id: string }) => v.id === variantId,
    );
    expect(stockBefore.inStock).toBe(true);

    const pay = await request(app).post('/api/checkout/mock-pay').send({ sessionId });
    expect(pay.status).toBe(200);

    const conf = await request(app).get(`/api/checkout/session/${sessionId}`);
    expect(conf.body.status).toBe('paid');
    expect(conf.body.order.items[0].quantity).toBe(2);
    expect(conf.body.order.shipping.line1).toBe(SHIPPING.line1);

    // Replay: idempotent — still paid, no double decrement.
    const replay = await request(app).post('/api/checkout/mock-pay').send({ sessionId });
    expect(replay.status).toBe(200);
    const conf2 = await request(app).get(`/api/checkout/session/${sessionId}`);
    expect(conf2.body.status).toBe('paid');
  });

  it('customer sees the order with payment_received stage', async () => {
    const res = await request(app).get('/api/account/orders').set('Cookie', customerCookie);
    expect(res.status).toBe(200);
    const order = res.body.orders.find((o: { id: string }) => o.id === orderId);
    expect(order.fulfillmentStage).toBe('payment_received');
  });

  it('SECURITY: another customer cannot read that order', async () => {
    const other = await request(app).post('/api/auth/register').send({
      email: 'stranger@test.local',
      password: 'password123',
      name: 'Stranger',
    });
    const res = await request(app)
      .get(`/api/account/orders/${orderId}`)
      .set('Cookie', cookieOf(other));
    expect(res.status).toBe(404);
  });

  it('admin signs in and advances the pipeline', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.local', password: 'test-admin-pass' });
    expect(login.status).toBe(200);
    expect(login.body.customer.role).toBe('admin');
    adminCookie = cookieOf(login);

    for (const stage of ['packaged', 'shipped']) {
      const res = await request(app)
        .patch(`/api/admin/orders/${orderId}/stage`)
        .set('Cookie', adminCookie)
        .send({ stage });
      expect(res.status).toBe(200);
    }

    const view = await request(app)
      .get(`/api/account/orders/${orderId}`)
      .set('Cookie', customerCookie);
    expect(view.body.order.fulfillmentStage).toBe('shipped');
    expect(view.body.order.events.length).toBeGreaterThanOrEqual(3);
  });

  it('customer confirms delivery; admin sees the customer event', async () => {
    const confirm = await request(app)
      .post(`/api/account/orders/${orderId}/confirm-delivery`)
      .set('Cookie', customerCookie);
    expect(confirm.status).toBe(200);

    const adminView = await request(app)
      .get(`/api/admin/orders/${orderId}`)
      .set('Cookie', adminCookie);
    expect(adminView.body.order.fulfillmentStage).toBe('delivered');
    expect(adminView.body.order.status).toBe('fulfilled');
    const last = adminView.body.order.events.at(-1);
    expect(last.actor).toBe('customer');
    expect(last.stage).toBe('delivered');
  });

  it('the message inbox recorded the whole journey, and read state persists', async () => {
    const res = await request(app).get('/api/account/messages').set('Cookie', customerCookie);
    expect(res.status).toBe(200);
    const titles = res.body.messages.map((m: { title: string }) => m.title);
    // Welcome + payment + packaged + shipped + delivered, newest first.
    expect(titles.some((t: string) => t.includes('Welcome'))).toBe(true);
    expect(titles.some((t: string) => t.includes('confirmed'))).toBe(true);
    expect(titles.some((t: string) => t.includes('packaged'))).toBe(true);
    expect(titles.some((t: string) => t.includes('on its way'))).toBe(true);
    expect(titles.some((t: string) => t.includes('delivered'))).toBe(true);
    expect(res.body.unreadCount).toBeGreaterThan(0);

    // Mark read — server-side, so it holds across sessions and devices.
    await request(app).post('/api/account/messages/read').set('Cookie', customerCookie);
    const after = await request(app).get('/api/account/messages').set('Cookie', customerCookie);
    expect(after.body.unreadCount).toBe(0);
  });

  it('SECURITY: another customer cannot read those messages', async () => {
    const other = await request(app)
      .post('/api/auth/login')
      .send({ email: 'stranger@test.local', password: 'password123' });
    const res = await request(app).get('/api/account/messages').set('Cookie', cookieOf(other));
    const orderTitles = res.body.messages.filter((m: { orderId: string | null }) => m.orderId);
    expect(orderTitles.length).toBe(0);
  });

  it('cart validation reports authoritative prices', async () => {
    const res = await request(app)
      .post('/api/cart/validate')
      .send({ items: [{ variantId, quantity: 1 }] });
    expect(res.status).toBe(200);
    expect(res.body.lines[0].unitPriceCents).toBe(2200);
  });
});
