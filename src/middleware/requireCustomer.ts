import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { adminJwtSecret } from '../config/env.js';
import { unauthorized } from '../lib/errors.js';

export const CUSTOMER_COOKIE = 'rb_customer';

export interface CustomerClaims {
  /** customer uuid */
  sub: string;
  exp: number;
}

export function signCustomerToken(customerId: string, expiresInSec: number): string {
  return jwt.sign({ sub: customerId, role: 'customer' }, adminJwtSecret, {
    expiresIn: expiresInSec,
    issuer: 'revelle-api',
    audience: 'revelle-customer',
    algorithm: 'HS256',
  });
}

export function requireCustomer(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[CUSTOMER_COOKIE] as string | undefined;
  if (!token) return next(unauthorized('Please sign in'));
  try {
    const claims = jwt.verify(token, adminJwtSecret, {
      issuer: 'revelle-api',
      audience: 'revelle-customer', // an admin token can never pass as a customer
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
    if (claims.role !== 'customer' || !claims.sub) return next(unauthorized('Please sign in'));
    (req as Request & { customer: CustomerClaims }).customer = {
      sub: String(claims.sub),
      exp: claims.exp ?? 0,
    };
    next();
  } catch {
    next(unauthorized('Session expired — please sign in again'));
  }
}

export function customerId(req: Request): string {
  return (req as Request & { customer: CustomerClaims }).customer.sub;
}
