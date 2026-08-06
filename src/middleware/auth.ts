import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { adminJwtSecret, env } from '../config/env.js';
import { forbidden, unauthorized } from '../lib/errors.js';

/**
 * One session for everyone. Customers and admins sign in through the same
 * endpoint and carry the same cookie; the role claim in the JWT decides what
 * the session may reach. Admin sessions are deliberately short-lived.
 */

export const SESSION_COOKIE = 'rb_session';

export type Role = 'customer' | 'admin';

export interface SessionClaims {
  /** user uuid */
  sub: string;
  role: Role;
  exp: number;
}

const CUSTOMER_SESSION_SEC = 30 * 24 * 3600;

export function sessionSeconds(role: Role): number {
  return role === 'admin' ? env.ADMIN_SESSION_HOURS * 3600 : CUSTOMER_SESSION_SEC;
}

export function signSessionToken(userId: string, role: Role, expiresInSec: number): string {
  return jwt.sign({ sub: userId, role }, adminJwtSecret, {
    expiresIn: expiresInSec,
    issuer: 'revelle-api',
    audience: 'revelle-auth',
    algorithm: 'HS256',
  });
}

function readSession(req: Request): SessionClaims | null {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = (req.cookies?.[SESSION_COOKIE] as string | undefined) ?? bearer;
  if (!token) return null;
  try {
    const claims = jwt.verify(token, adminJwtSecret, {
      issuer: 'revelle-api',
      audience: 'revelle-auth',
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
    if (!claims.sub || (claims.role !== 'customer' && claims.role !== 'admin')) return null;
    return { sub: String(claims.sub), role: claims.role, exp: claims.exp ?? 0 };
  } catch {
    return null;
  }
}

/** Any signed-in user (customer or admin). */
export function requireCustomer(req: Request, _res: Response, next: NextFunction): void {
  const session = readSession(req);
  if (!session) return next(unauthorized('Please sign in'));
  (req as Request & { session: SessionClaims }).session = session;
  next();
}

/** Signed-in AND role=admin. 401 when anonymous, 403 when merely a customer. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const session = readSession(req);
  if (!session) return next(unauthorized('Please sign in'));
  if (session.role !== 'admin') return next(forbidden('Admin access required'));
  (req as Request & { session: SessionClaims }).session = session;
  next();
}

export function customerId(req: Request): string {
  return (req as Request & { session: SessionClaims }).session.sub;
}

export function sessionOf(req: Request): SessionClaims {
  return (req as Request & { session: SessionClaims }).session;
}
