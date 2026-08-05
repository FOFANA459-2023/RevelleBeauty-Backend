import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { adminJwtSecret, env, isProd } from '../../config/env.js';
import { unauthorized } from '../../lib/errors.js';
import { ADMIN_COOKIE, requireAdmin } from '../../middleware/requireAdmin.js';
import { loginLimiter } from '../../middleware/rateLimit.js';

const loginSchema = z.object({ password: z.string().min(1).max(200) }).strict();

export function adminAuthRoutes(): Router {
  const r = Router();

  r.post('/login', loginLimiter, async (req, res) => {
    const { password } = loginSchema.parse(req.body);

    let ok = false;
    if (env.ADMIN_PASSWORD_HASH) {
      ok = await bcrypt.compare(password, env.ADMIN_PASSWORD_HASH);
    } else if (!isProd) {
      // Dev fallback: plain compare against ADMIN_DEV_PASSWORD (default 'revelle-admin').
      ok = password === env.ADMIN_DEV_PASSWORD;
    }
    if (!ok) throw unauthorized('Invalid password');

    const expiresInSec = env.ADMIN_SESSION_HOURS * 3600;
    const token = jwt.sign({ sub: 'admin', role: 'admin' }, adminJwtSecret, {
      expiresIn: expiresInSec,
      issuer: 'revelle-api',
      audience: 'revelle-admin',
      algorithm: 'HS256',
    });
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
    const admin = (req as unknown as { admin: { exp: number } }).admin;
    res.json({ admin: true, expiresAt: new Date(admin.exp * 1000).toISOString() });
  });

  return r;
}
