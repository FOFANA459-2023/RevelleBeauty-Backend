import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { displayName } from '../../src/modules/reviews/reviews.routes.js';

let app: Express;
let pool: Pool;

const SLUG = 'creamy-matte-lipstick';

async function register(email: string, name: string): Promise<{ cookie: string; id: string }> {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'password123', name });
  expect(res.status).toBe(201);
  const cookie = (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
  return { cookie, id: res.body.customer.id };
}

async function adminCookie(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@test.local', password: 'test-admin-pass' });
  return (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
}

beforeAll(async () => {
  const { getPool } = await import('../../src/db/pool.js');
  const { seedAdminUser } = await import('../../src/db/seed-admin.js');
  const { buildApp } = await import('../../src/app.js');
  pool = await getPool();
  await seedAdminUser(pool);
  app = buildApp(pool);
});

describe('product reviews', () => {
  it('a product with no reviews has no rating and no summary', async () => {
    const res = await request(app).get(`/api/products/${SLUG}/reviews`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ summary: null, reviews: [], total: 0 });
    const product = await request(app).get(`/api/products/${SLUG}`);
    expect(product.body.product.rating).toBeNull();
  });

  it('posting a review needs an account', async () => {
    const res = await request(app)
      .put(`/api/products/${SLUG}/reviews/mine`)
      .send({ rating: 5, body: 'Lovely color, lasts all day.' });
    expect(res.status).toBe(401);
  });

  it('rejects ratings out of range, short bodies and unknown fields', async () => {
    const { cookie } = await register('rv-bad@test.local', 'Bad Input');
    for (const body of [
      { rating: 0, body: 'Long enough body text.' },
      { rating: 6, body: 'Long enough body text.' },
      { rating: 4.5, body: 'Long enough body text.' },
      { rating: 5, body: '   short   ' },
      { rating: 5, body: 'x'.repeat(2001) },
      { rating: 5, body: 'Long enough body text.', verifiedPurchase: true },
      { rating: 5, body: 'Long enough body text.', status: 'published' },
    ]) {
      const res = await request(app).put(`/api/products/${SLUG}/reviews/mine`).set('Cookie', cookie).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('a customer posts, the review appears with a privacy-safe name, and the rating updates', async () => {
    const { cookie } = await register('rv-amara@test.local', 'Amara Grace Johnson');
    const put = await request(app)
      .put(`/api/products/${SLUG}/reviews/mine`)
      .set('Cookie', cookie)
      .send({ rating: 5, title: '  Velvet  ', body: 'Does not dry out and the color is true.\u0007' });
    expect(put.status).toBe(200);
    expect(put.body.review).toMatchObject({ rating: 5, title: 'Velvet', status: 'published' });
    expect(put.body.review.body).toBe('Does not dry out and the color is true.');

    const list = await request(app).get(`/api/products/${SLUG}/reviews`);
    expect(list.body.total).toBe(1);
    expect(list.body.summary).toEqual({ average: 5, count: 1, distribution: [0, 0, 0, 0, 1] });
    const [review] = list.body.reviews;
    expect(review.author).toBe('Amara J.');
    expect(review.verifiedPurchase).toBe(false);
    expect(JSON.stringify(list.body)).not.toContain('rv-amara@test.local');
    expect(JSON.stringify(list.body)).not.toContain('Johnson');

    // Product card + page carry the rating (catalog cache was dropped on write).
    const product = await request(app).get(`/api/products/${SLUG}`);
    expect(product.body.product.rating).toEqual({ average: 5, count: 1 });
  });

  it('posting again edits the same review rather than adding a second', async () => {
    const { cookie } = await register('rv-edit@test.local', 'Dani Rivers');
    await request(app).put(`/api/products/${SLUG}/reviews/mine`).set('Cookie', cookie)
      .send({ rating: 2, body: 'Too drying for me, sadly.' });
    const again = await request(app).put(`/api/products/${SLUG}/reviews/mine`).set('Cookie', cookie)
      .send({ rating: 3, body: 'Better with a balm underneath.' });
    expect(again.status).toBe(200);

    const mine = await request(app).get(`/api/products/${SLUG}/reviews/mine`).set('Cookie', cookie);
    expect(mine.body.review).toMatchObject({ rating: 3, body: 'Better with a balm underneath.' });
    expect(mine.headers['cache-control']).toContain('no-store');

    const list = await request(app).get(`/api/products/${SLUG}/reviews`);
    expect(list.body.total).toBe(2);
    expect(list.body.summary.average).toBe(4);
  });

  it('marks a review verified only when the author has a paid order with the product', async () => {
    const { cookie, id } = await register('rv-buyer@test.local', 'Leila Moss');
    const { rows: [order] } = await pool.query<{ id: string }>(
      `insert into orders (customer_id, status, subtotal_cents, total_cents)
       values ($1, 'paid', 1499, 1499) returning id`,
      [id],
    );
    await pool.query(
      `insert into order_items (order_id, product_id, product_name, product_slug, variant_name, unit_price_cents, quantity)
       select $1, p.id, p.name, p.slug, 'CM101', 1499, 1 from products p where p.slug = $2`,
      [order!.id, SLUG],
    );
    await request(app).put(`/api/products/${SLUG}/reviews/mine`).set('Cookie', cookie)
      .send({ rating: 4, body: 'Bought it twice already.' });

    const list = await request(app).get(`/api/products/${SLUG}/reviews?sort=lowest`);
    const byAuthor = Object.fromEntries(
      list.body.reviews.map((r: { author: string; verifiedPurchase: boolean }) => [r.author, r.verifiedPurchase]),
    );
    expect(byAuthor['Leila M.']).toBe(true);
    expect(byAuthor['Amara J.']).toBe(false);
    expect(list.body.reviews[0].rating).toBe(3); // sort=lowest
  });

  it('the homepage feed shows only real four- and five-star reviews, with their product', async () => {
    const res = await request(app).get('/api/reviews/recent?limit=6');
    expect(res.status).toBe(200);
    expect(res.body.reviews.length).toBe(2);
    for (const r of res.body.reviews) {
      expect(r.rating).toBeGreaterThanOrEqual(4);
      expect(r.product).toEqual({ slug: SLUG, name: 'Creamy Matte Lipstick' });
    }
  });

  it('an admin can hide a review; it leaves the page and the average, and editing keeps it hidden', async () => {
    const admin = await adminCookie();
    const { cookie } = await register('rv-spam@test.local', 'Spam Bot');
    await request(app).put(`/api/products/${SLUG}/reviews/mine`).set('Cookie', cookie)
      .send({ rating: 1, body: 'Visit my site for cheap stuff.' });

    const queue = await request(app).get('/api/admin/reviews').set('Cookie', admin);
    expect(queue.status).toBe(200);
    const spam = queue.body.reviews.find((r: { customerEmail: string }) => r.customerEmail === 'rv-spam@test.local');
    expect(spam).toBeDefined();

    expect((await request(app).patch(`/api/admin/reviews/${spam.id}`).set('Cookie', admin)
      .send({ status: 'hidden' })).status).toBe(200);

    const list = await request(app).get(`/api/products/${SLUG}/reviews`);
    expect(list.body.reviews.some((r: { id: string }) => r.id === spam.id)).toBe(false);
    expect(list.body.summary.distribution[0]).toBe(0);

    const edit = await request(app).put(`/api/products/${SLUG}/reviews/mine`).set('Cookie', cookie)
      .send({ rating: 5, body: 'Now pretending to be nice.' });
    expect(edit.body.review.status).toBe('hidden');
  });

  it('customers cannot reach moderation, and a customer can delete their own review', async () => {
    const { cookie } = await register('rv-del@test.local', 'Del Ete');
    expect((await request(app).get('/api/admin/reviews').set('Cookie', cookie)).status).toBe(403);
    expect((await request(app).get('/api/admin/reviews')).status).toBe(401);

    await request(app).put(`/api/products/${SLUG}/reviews/mine`).set('Cookie', cookie)
      .send({ rating: 4, body: 'Pretty good overall.' });
    const before = (await request(app).get(`/api/products/${SLUG}/reviews`)).body.total;
    expect((await request(app).delete(`/api/products/${SLUG}/reviews/mine`).set('Cookie', cookie)).status).toBe(204);
    expect((await request(app).get(`/api/products/${SLUG}/reviews`)).body.total).toBe(before - 1);
  });

  it('unknown products 404 and malformed slugs 400', async () => {
    expect((await request(app).get('/api/products/no-such-thing/reviews')).status).toBe(404);
    expect((await request(app).get('/api/products/Bad_Slug!/reviews')).status).toBe(400);
  });
});

describe('displayName', () => {
  it('keeps the first name and the last initial only', () => {
    expect(displayName('Amara Grace Johnson')).toBe('Amara J.');
    expect(displayName('  cher  ')).toBe('cher');
    expect(displayName('')).toBe('Revelle customer');
  });
});
