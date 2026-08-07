import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Mail } from '../../src/lib/mailer.js';

let app: Express;
let outbox: Mail[];

beforeAll(async () => {
  const { getPool } = await import('../../src/db/pool.js');
  const { seedAdminUser } = await import('../../src/db/seed-admin.js');
  const { buildApp } = await import('../../src/app.js');
  const { mailOutboxForTest } = await import('../../src/lib/mailer.js');
  const pool = await getPool();
  await seedAdminUser(pool);
  app = buildApp(pool);
  outbox = mailOutboxForTest;
});

function tokenFromMail(mail: Mail): string {
  const m = mail.text.match(/\/reset-password\?token=([A-Za-z0-9_-]+)/);
  expect(m, 'reset link present in email').toBeTruthy();
  return m![1]!;
}

describe('password reset', () => {
  const email = 'reset-me@test.local';
  const oldPassword = 'original-pass-123';
  const newPassword = 'brand-new-pass-456';

  it('unknown email still answers 200 and sends nothing (no enumeration)', async () => {
    const before = outbox.length;
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@test.local' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(outbox.length).toBe(before);
  });

  it('the admin account never gets a reset email (credential lives in env)', async () => {
    const before = outbox.length;
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'admin@test.local' });
    expect(res.status).toBe(200);
    expect(outbox.length).toBe(before);
  });

  it('full flow: forgot -> email -> reset -> old password dead, new works', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, password: oldPassword, name: 'Reset Me' });
    expect(reg.status).toBe(201);

    const forgot = await request(app).post('/api/auth/forgot-password').send({ email });
    expect(forgot.status).toBe(200);

    const mail = outbox.at(-1)!;
    expect(mail.to).toBe(email);
    expect(mail.subject).toMatch(/reset/i);
    expect(mail.html).toContain('/reset-password?token=');
    const token = tokenFromMail(mail);

    // Wrong token is rejected without leaking anything else.
    const bad = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'x'.repeat(43), password: newPassword });
    expect(bad.status).toBe(400);

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: newPassword });
    expect(reset.status).toBe(200);

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email, password: oldPassword });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email, password: newPassword });
    expect(newLogin.status).toBe(200);

    // The link is single-use.
    const replay = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'yet-another-pass-789' });
    expect(replay.status).toBe(400);
  });

  it('a newer reset request voids the older link', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email });
    const first = tokenFromMail(outbox.at(-1)!);
    await request(app).post('/api/auth/forgot-password').send({ email });
    const second = tokenFromMail(outbox.at(-1)!);
    expect(second).not.toBe(first);

    const stale = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: first, password: 'whatever-pass-000' });
    expect(stale.status).toBe(400);

    const fresh = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: second, password: newPassword });
    expect(fresh.status).toBe(200);
  });
});
