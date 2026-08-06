import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { adminJwtSecret, env, isProd } from '../../config/env.js';
import { unauthorized } from '../../lib/errors.js';
import { ADMIN_COOKIE, requireAdmin } from '../../middleware/requireAdmin.js';
import { loginLimiter } from '../../middleware/rateLimit.js';

const loginSchema = z
  .object({
    email: z.string().email().max(200),
    password: z.string().min(1).max(200),
  })
  .strict();

export function adminAuthRoutes(): Router {
  const r = Router();

  r.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    // Email check first, but ALWAYS run the bcrypt compare so a wrong email
    // costs the same time as a wrong password (no user-enumeration timing).
    const emailOk = env.ADMIN_EMAIL
      ? email.trim().toLowerCase() === env.ADMIN_EMAIL.toLowerCase()
      : !isProd; // dev without ADMIN_EMAIL configured: accept any email

    let passwordOk = false;
    if (env.ADMIN_PASSWORD_HASH) {
      passwordOk = await bcrypt.compare(password, env.ADMIN_PASSWORD_HASH);
    } else if (!isProd) {
      passwordOk = password === env.ADMIN_DEV_PASSWORD;
    }

    if (!emailOk || !passwordOk) throw unauthorized('Invalid email or password');

    const expiresInSec = env.ADMIN_SESSION_HOURS * 3600;
    const token = jwt.sign(
      { sub: env.ADMIN_EMAIL ?? 'admin', role: 'admin' },
      adminJwtSecret,
      {
        expiresIn: expiresInSec,
        issuer: 'revelle-api',
        audience: 'revelle-admin',
        algorithm: 'HS256',
      },
    );
    const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString();

    res.cookie(ADMIN_COOKIE, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      path: '/api/admin',
      maxAge: expiresInSec * 1000,
    });
    res.json({ ok: true, expiresAt });
  });

  r.post('/logout', (_req, res) => {
    res.clearCookie(ADMIN_COOKIE, { path: '/api/admin' });
    res.json({ ok: true });
  });

  r.get('/me', requireAdmin, (req, res) => {
    const admin = (req as unknown as { admin: { sub: string; exp: number } }).admin;
    res.json({
      admin: true,
      email: admin.sub !== 'admin' ? admin.sub : null,
      expiresAt: new Date(admin.exp * 1000).toISOString(),
    });
  });

  return r;
}
