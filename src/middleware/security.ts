import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { forbidden } from '../lib/errors.js';

/**
 * Edge security for an API that takes payments.
 *
 * originLock — the API is meant to be reached only through the Cloudflare
 *   Worker. The Worker adds a shared secret header; anything without it (a
 *   scanner hitting the VM's IP, someone bypassing Cloudflare to spoof
 *   X-Forwarded-For past the rate limits) is refused. Enabled by setting
 *   ORIGIN_SHARED_SECRET on both sides. The health check stays open so the
 *   container's own healthcheck works.
 *
 * csrfGuard — sessions are cookies, so every state-changing request must come
 *   from our own site. Browsers mark cross-site requests (Sec-Fetch-Site) and
 *   always send Origin on them; either one naming another site is refused.
 *   Non-browser clients send neither and carry no victim's cookie, so they
 *   pass. Stripe webhooks are exempt: they are authenticated by signature.
 */

export const ORIGIN_AUTH_HEADER = 'x-origin-auth';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function originLock(secret: string | undefined) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!secret || req.path === '/api/health') return next();
    const given = req.get(ORIGIN_AUTH_HEADER);
    if (given && safeEqual(given, secret)) return next();
    next(forbidden('Direct access is not allowed'));
  };
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Every origin our own site is served from. */
export function allowedOrigins(): Set<string> {
  const list = [env.FRONTEND_URL, ...env.CORS_ORIGINS];
  return new Set(
    list.flatMap((u) => {
      try {
        return [new URL(u).origin];
      } catch {
        return [];
      }
    }),
  );
}

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return 'invalid';
  }
}

export function csrfGuard(allowed: Set<string> = allowedOrigins()) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!UNSAFE.has(req.method) || req.path.startsWith('/api/webhooks/')) return next();

    if (req.get('sec-fetch-site') === 'cross-site') {
      return next(forbidden('Cross-site request refused'));
    }
    // Origin first, Referer as fallback. An opaque "null" origin (sandboxed
    // frame, data: URL) doesn't parse, so it is refused like any other site.
    const origin = originOf(req.get('origin')) ?? originOf(req.get('referer'));
    if (origin && !allowed.has(origin)) {
      return next(forbidden('Cross-site request refused'));
    }
    next();
  };
}
