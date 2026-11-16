import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env.js';
import { tlsFor } from '../../src/db/pool.js';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----';
const SUPABASE = 'postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';

afterEach(() => {
  env.DATABASE_SSL_CA = undefined;
});

describe('database TLS', () => {
  it('verifies the server certificate when the CA is provided', () => {
    env.DATABASE_SSL_CA = PEM;
    expect(tlsFor(SUPABASE)).toEqual({ ca: PEM, rejectUnauthorized: true });
  });

  it('accepts a CA pasted with escaped newlines (single-line env files)', () => {
    env.DATABASE_SSL_CA = PEM.replace(/\n/g, '\\n');
    expect(tlsFor(SUPABASE)).toEqual({ ca: PEM, rejectUnauthorized: true });
  });

  it('still encrypts Supabase without a CA, and uses no TLS for a local database', () => {
    expect(tlsFor(SUPABASE)).toEqual({ rejectUnauthorized: false });
    expect(tlsFor('postgresql://revelle:revelle@localhost:5544/revelle')).toBeUndefined();
  });
});
