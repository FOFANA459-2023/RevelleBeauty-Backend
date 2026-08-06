import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  const { getPool } = await import('../../src/db/pool.js');
  const { buildApp } = await import('../../src/app.js');
  app = buildApp(await getPool());
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

  it('a CUSTOMER token cannot open ADMIN endpoints (audience separation)', async () => {
    const reg = await request(app).post('/api/auth/register').send({
      email: 'audsep@test.local',
      password: 'password123',
      name: 'Aud Sep',
    });
    const cookie = (reg.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');
    // Present the customer JWT as if it were the admin cookie.
    const token = cookie.split('rb_customer=')[1] ?? '';
    const res = await request(app)
      .get('/api/admin/products')
      .set('Cookie', `rb_admin=${token}`);
    expect(res.status).toBe(401);
  });

  it('admin login rejects wrong email and wrong password alike', async () => {
    expect(
      (await request(app).post('/api/admin/login')
        .send({ email: 'admin@test.local', password: 'nope' })).status,
    ).toBe(401);
    expect(
      (await request(app).post('/api/admin/login')
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

  it('unknown API routes return a JSON 404, not a stack trace', async () => {
    const res = await request(app).get('/api/definitely-not-real');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
