import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { mailOutboxForTest } from '../../src/lib/mailer.js';
import { whatsappOutboxForTest } from '../../src/lib/whatsapp.js';

let app: Express;
let cookie = '';
let variantId = '';
let orderId = '';

const SHIPPING = {
  name: 'Amara Johnson',
  phone: '+1 555 123 4567',
  line1: '12 Rose Street',
  line2: 'Apt 4',
  city: 'Austin',
  state: 'TX',
  postalCode: '78701',
  country: 'US',
};

const cookieOf = (res: request.Response) =>
  (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');

beforeAll(async () => {
  const { getPool } = await import('../../src/db/pool.js');
  const { seedAdminUser } = await import('../../src/db/seed-admin.js');
  const { buildApp } = await import('../../src/app.js');
  const pool = await getPool();
  await seedAdminUser(pool);
  app = buildApp(pool);

  const reg = await request(app).post('/api/auth/register').send({
    email: 'notify@test.local', password: 'password123', name: 'Amara Johnson',
  });
  cookie = cookieOf(reg);
  const detail = await request(app).get('/api/products/creamy-matte-lipstick');
  variantId = detail.body.product.variants[0].id;
});

describe('new-order notifications', () => {
  it('pre-ordering is gone: checkout always goes through payment', async () => {
    const res = await request(app).post('/api/checkout/preorder').set('Cookie', cookie)
      .send({ items: [{ variantId, quantity: 1 }], shipping: SHIPPING });
    expect(res.status).toBe(404);
    const settings = await request(app).get('/api/settings');
    expect(settings.body).not.toHaveProperty('checkoutMode');
  });

  it('tell the store and the customer once the order is paid, once only', async () => {
    mailOutboxForTest.length = 0;
    whatsappOutboxForTest.length = 0;
    const session = await request(app)
      .post('/api/checkout/session')
      .set('Cookie', cookie)
      .send({ items: [{ variantId, quantity: 1 }], shipping: SHIPPING });
    expect(session.status).toBe(200);
    const { sessionId, orderNumber } = session.body;

    // Nothing is announced until the money is in.
    expect(mailOutboxForTest).toHaveLength(0);
    expect(whatsappOutboxForTest).toHaveLength(0);

    // The webhook and the success-page fallback can both confirm a payment.
    for (let i = 0; i < 2; i++) {
      expect((await request(app).post('/api/checkout/mock-pay').send({ sessionId })).status).toBe(200);
    }

    const store = mailOutboxForTest.filter((m) => m.to === 'orders@test.local');
    const customer = mailOutboxForTest.filter((m) => m.to === 'notify@test.local');
    expect(store).toHaveLength(1);
    expect(customer).toHaveLength(1);
    expect(store[0]!.subject).toBe(`New order ${orderNumber} · PAID $${(session.body.totals.totalCents / 100).toFixed(2)} · Amara Johnson`);
    expect(store[0]!.text).toContain('PAID online');
    expect(store[0]!.text).toContain('+1 555 123 4567');
    expect(store[0]!.text).toContain('12 Rose Street');
    expect(store[0]!.html).toContain('https://wa.me/15551234567');
    expect(customer[0]!.subject).toBe(`Your Revelle order ${orderNumber} is confirmed`);
    expect(customer[0]!.text).toContain('confirmed and paid');
    expect(customer[0]!.html).toContain('https://wa.me/15550100000');
    // The logo and the product photo are embedded, not hot-linked.
    expect(customer[0]!.html).toContain('src="cid:logo@revelle"');
    expect(customer[0]!.inline?.[0]?.url).toMatch(/\/email\/logo\.png$/);
    orderId = session.body.orderId;

    expect(whatsappOutboxForTest).toHaveLength(1);
    expect(whatsappOutboxForTest[0]!.to).toBe('15550100000');
    expect(whatsappOutboxForTest[0]!.text).toContain(`*New order ${orderNumber}* ✅ PAID`);
  });

  it('email the customer as the order is packed, shipped (with tracking) and delivered', async () => {
    const login = await request(app).post('/api/auth/login')
      .send({ email: 'admin@test.local', password: 'test-admin-pass' });
    const admin = cookieOf(login);
    const mine = () => mailOutboxForTest.filter((m) => m.to === 'notify@test.local');
    const settle = async (n: number) => {
      for (let i = 0; i < 50 && mine().length < n; i++) await new Promise((r) => setTimeout(r, 20));
    };
    mailOutboxForTest.length = 0;

    const stage = (s: string) =>
      request(app).patch(`/api/admin/orders/${orderId}/stage`).set('Cookie', admin).send({ stage: s });

    expect((await stage('packaged')).status).toBe(200);
    await settle(1);
    expect(mine()[0]!.subject).toMatch(/is packed$/);

    // Marking the same stage again doesn't email twice.
    expect((await stage('packaged')).status).toBe(200);

    expect((await request(app).patch(`/api/admin/orders/${orderId}`).set('Cookie', admin)
      .send({ trackingNumber: '1Z999AA10123456784' })).status).toBe(200);
    expect((await stage('shipped')).status).toBe(200);
    await settle(2);
    expect(mine()[1]!.subject).toMatch(/is on its way$/);
    expect(mine()[1]!.text).toContain('Tracking number: 1Z999AA10123456784');

    expect((await stage('delivered')).status).toBe(200);
    await settle(3);
    await new Promise((r) => setTimeout(r, 100));
    expect(mine().map((m) => m.subject.replace(/^.* is |^.* was /, ''))).toEqual(['packed', 'on its way', 'delivered']);
  });
});
