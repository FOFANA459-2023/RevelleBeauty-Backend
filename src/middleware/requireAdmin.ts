import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { adminJwtSecret } from '../config/env.js';
import { unauthorized } from '../lib/errors.js';

export const ADMIN_COOKIE = 'rb_admin';

export interface AdminClaims {
  sub: string;
  role: string;
  exp: number;
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = (req.cookies?.[ADMIN_COOKIE] as string | undefined) ?? bearer;

  if (!token) return next(unauthorized('Admin session required'));

  try {
    const claims = jwt.verify(token, adminJwtSecret, {
      issuer: 'revelle-api',
      audience: 'revelle-admin',
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;

    if (claims.role !== 'admin') return next(unauthorized('Admin session required'));
    (req as Request & { admin: AdminClaims }).admin = {
      sub: String(claims.sub),
      role: 'admin',
      exp: claims.exp ?? 0,
    };
    next();
  } catch {
    next(unauthorized('Session expired'));
  }
}
