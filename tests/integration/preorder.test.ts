import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { mailOutboxForTest } from '../../src/lib/mailer.js';
import { whatsappOutboxForTest } from '../../src/lib/whatsapp.js';

let app: Express;
let pool: Pool;
let cookie = '';
let variantId = '';
let unitPriceCents = 0;
let reference = '';
let orderId = '';
let orderNumber = '';

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
  pool = await getPool();
  await seedAdminUser(pool);
  app = buildApp(pool);

  const reg = await request(app).post('/api/auth/register').send({
    email: 'preorder@test.local', password: 'password123', name: 'Amara Johnson',
  });
  cookie = cookieOf(reg);
  const detail = await request(app).get('/api/products/creamy-matte-lipstick');
  variantId = detail.body.product.variants[0].id;
  unitPriceCents = detail.body.product.variants[0].priceCents;
});

describe('pre-orders', () => {
  it('the storefront is told checkout is pre-order and how to reach the store', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.body.checkoutMode).toBe('preorder');
    expect(res.body.storeWhatsapp).toBe('15550100000');
    // The store's email address is never public.
    expect(JSON.stringify(res.body)).not.toContain('orders@test.local');
  });

  it('needs an account, and rejects prices and oversized notes', async () => {
    const body = { items: [{ variantId, quantity: 1 }], shipping: SHIPPING };
    expect((await request(app).post('/api/checkout/preorder').send(body)).status).toBe(401);
    expect((await request(app).post('/api/checkout/preorder').set('Cookie', cookie)
      .send({ ...body, items: [{ variantId, quantity: 1, price: 1 }] })).status).toBe(400);
    expect((await request(app).post('/api/checkout/preorder').set('Cookie', cookie)
      .send({ ...body, note: 'x'.repeat(501) })).status).toBe(400);
    expect((await request(app).post('/api/checkout/preorder').set('Cookie', cookie)
      .send({ ...body, items: [{ variantId, quantity: 0 }] })).status).toBe(400);
  });

  it('places the order without payment and notifies the store and the customer', async () => {
    mailOutboxForTest.length = 0;
    whatsappOutboxForTest.length = 0;
    const res = await request(app)
      .post('/api/checkout/preorder')
      .set('Cookie', cookie)
      .send({ items: [{ variantId, quantity: 2 }], shipping: SHIPPING, note: 'Gift wrap please <3' });
    expect(res.status).toBe(201);
    expect(res.body.orderNumber).toMatch(/^RB-\d+$/);
    expect(res.body.totals.subtotalCents).toBe(unitPriceCents * 2);
    ({ reference, orderId, orderNumber } = res.body);

    const store = mailOutboxForTest.find((m) => m.to === 'orders@test.local')!;
    const customer = mailOutboxForTest.find((m) => m.to === 'preorder@test.local')!;
    expect(store.subject).toContain(`New pre-order ${orderNumber}`);
    expect(store.text).toContain('Amara Johnson');
    expect(store.text).toContain('+1 555 123 4567');
    expect(store.text).toContain('12 Rose Street');
    expect(store.text).toContain('Gift wrap please <3');
    expect(store.html).toContain('Gift wrap please &lt;3'); // escaped in HTML
    expect(store.html).toContain('https://wa.me/15551234567');
    expect(customer.subject).toBe(`Your Revelle pre-order ${orderNumber}`);
    expect(customer.text).toContain('Nothing has been charged');
    expect(customer.html).toContain('https://wa.me/15550100000');

    expect(whatsappOutboxForTest).toHaveLength(1);
    expect(whatsappOutboxForTest[0]!.to).toBe('15550100000');
    expect(whatsappOutboxForTest[0]!.text).toContain(`*New pre-order ${orderNumber}*`);
  });

  it('the confirmation page shows it as a pre-order, and the customer sees it in their account', async () => {
    const conf = await request(app).get(`/api/checkout/session/${reference}`);
    expect(conf.body.status).toBe('preorder');
    expect(conf.body.order.items[0].quantity).toBe(2);

    const mine = await request(app).get('/api/account/orders').set('Cookie', cookie);
    const order = mine.body.orders.find((o: { id: string }) => o.id === orderId);
    expect(order.status).toBe('preorder');
    expect(order.fulfillmentStage).toBe('awaiting_payment');
  });

  it('stock is untouched until the store marks the pre-order paid', async () => {
    const stock = async () =>
      (await pool.query<{ stock_quantity: number }>(
        `select stock_quantity from product_variants where id = $1`, [variantId],
      )).rows[0]!.stock_quantity;
    const before = await stock();

    const login = await request(app).post('/api/auth/login')
      .send({ email: 'admin@test.local', password: 'test-admin-pass' });
    const admin = cookieOf(login);
    const paid = await request(app).patch(`/api/admin/orders/${orderId}`).set('Cookie', admin)
      .send({ status: 'paid' });
    expect(paid.status).toBe(200);

    const { rows: [o] } = await pool.query(
      `select status::text, payment_status::text, paid_at from orders where id = $1`, [orderId],
    );
    expect(o.status).toBe('paid');
    expect(o.payment_status).toBe('paid');
    expect(o.paid_at).not.toBeNull();
    expect(await stock()).toBe(before - 2);
  });
});
