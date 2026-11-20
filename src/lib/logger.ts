import { pino } from 'pino';
import { env, isDev } from '../config/env.js';

/**
 * Request and response fields that must never reach a log line: sessions,
 * the Cloudflare Worker's shared origin secret (whoever reads it can bypass
 * the origin lock), and Stripe's webhook signatures.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-origin-auth"]',
  'req.headers["stripe-signature"]',
  'res.headers["set-cookie"]',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined,
});
