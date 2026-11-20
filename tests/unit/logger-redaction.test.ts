import { describe, expect, it } from 'vitest';
import { pino } from 'pino';
import { REDACT_PATHS } from '../../src/lib/logger.js';

describe('log redaction', () => {
  it('never writes sessions, the origin secret or Stripe signatures to the log', () => {
    const lines: string[] = [];
    const log = pino(
      { redact: { paths: REDACT_PATHS, censor: '[redacted]' } },
      { write: (line: string) => { lines.push(line); } },
    );
    log.info({
      req: {
        headers: {
          cookie: 'rb_session=secret-session',
          authorization: 'Bearer secret-token',
          'x-origin-auth': 'secret-origin-key',
          'stripe-signature': 't=1,v1=secret-signature',
          'user-agent': 'kept',
        },
      },
      res: { headers: { 'set-cookie': 'rb_session=secret-session' } },
    }, 'request completed');

    const out = lines.join('');
    for (const secret of ['secret-session', 'secret-token', 'secret-origin-key', 'secret-signature']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('[redacted]');
    expect(out).toContain('kept');
  });
});
