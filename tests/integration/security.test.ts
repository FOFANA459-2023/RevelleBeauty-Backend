import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  const { getPool } = await import('../../src/db/pool.js');
  const { seedAdminUser } = await import('../../src/db/seed-admin.js');
  const { buildApp } = await import('../../src/app.js');
  const pool = await getPool();
  await seedAdminUser(pool);
  app = buildApp(pool);
});

describe('security posture', () => {
  it('every admin endpoint 401s without a session', async () => {
    for (const [method, path] of [
      ['get', '/api/admin/products'],
      ['get', '/api/admin/orders'],
      ['get', '/api/admin/stats'],
      ['post', '/api/admin/products'],
      ['patch', '/api/admin/orders/00000000-0000-0000-0000-000000000000'],
    ] as const) {
      const res = await request(app)[method](path);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
    }
  });

  it('account endpoints 401 without a customer session', async () => {
    expect((await request(app).get('/api/account/orders')).status).toBe(401);
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
  });

  it('a CUSTOMER session cannot open ADMIN endpoints (role separation)', async () => {
    const reg = await request(app).post('/api/auth/register').send({
      email: 'audsep@test.local',
      password: 'password123',
      name: 'Aud Sep',
    });
    const cookie = (reg.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');
    const res = await request(app).get('/api/admin/products').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('an ADMIN session opens both admin and account endpoints', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.local', password: 'test-admin-pass' });
    expect(login.status).toBe(200);
    expect(login.body.customer.role).toBe('admin');
    const cookie = (login.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');
    expect((await request(app).get('/api/admin/products').set('Cookie', cookie)).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);
  });

  it('login rejects wrong email and wrong password alike', async () => {
    expect(
      (await request(app).post('/api/auth/login')
        .send({ email: 'admin@test.local', password: 'nope' })).status,
    ).toBe(401);
    expect(
      (await request(app).post('/api/auth/login')
        .send({ email: 'wrong@test.local', password: 'test-admin-pass' })).status,
    ).toBe(401);
  });

  it('the admin email cannot be registered as a shopper account', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'admin@test.local',
      password: 'password123',
      name: 'Sneaky',
    });
    expect(res.status).toBe(400);
  });

  it('personal endpoints send Cache-Control: no-store', async () => {
    for (const path of ['/api/auth/me', '/api/account/orders']) {
      const res = await request(app).get(path);
      expect(res.headers['cache-control'], path).toBe('private, no-store');
    }
  });

  it('login responses never include the password hash', async () => {
    const reg = await request(app).post('/api/auth/register').send({
      email: 'cleanreply@test.local',
      password: 'password123',
      name: 'Clean Reply',
    });
    expect(JSON.stringify(reg.body)).not.toContain('hash');
    expect(JSON.stringify(reg.body)).not.toContain('password');
    expect(JSON.stringify(reg.body)).not.toContain('$2'); // bcrypt prefix
  });

  it('registration requires a minimally strong password', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'weak@test.local',
      password: 'short',
      name: 'Weak',
    });
    expect(res.status).toBe(400);
  });

  it('the webhook acknowledges but ignores events when Stripe is unconfigured', async () => {
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send('{"type":"checkout.session.completed"}');
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBeDefined();
  });

  it('rejects a malformed path parameter before it reaches the database', async () => {
    // A slug the catalog could never have issued. Rejected at the edge as a
    // client error, rather than reaching SQL and surfacing as a 500.
    for (const slug of ['NOT_A_SLUG', 'bad..slug', 'drop%20table', 'a'.repeat(300)]) {
      const res = await request(app).get(`/api/products/${slug}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    }
  });

  it('keeps an oversized slug out of the related-products cache key', async () => {
    const res = await request(app).get(`/api/products/${'z'.repeat(400)}/related`);
    expect(res.status).toBe(400);
  });

  it('still serves the slugs the catalog does issue', async () => {
    const ok = await request(app).get('/api/products/high-shine-lip-oil');
    expect(ok.status).toBe(200);
    const missing = await request(app).get('/api/products/no-such-product');
    expect(missing.status).toBe(404); // well-formed, simply absent
  });

  it('unknown API routes return a JSON 404, not a stack trace', async () => {
    const res = await request(app).get('/api/definitely-not-real');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
