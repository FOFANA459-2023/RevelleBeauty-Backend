import { describe, expect, it } from 'vitest';
import { stripeKeyMode } from '../../src/config/env.js';

describe('Stripe key mode', () => {
  it('recognises full secret keys and permission-scoped restricted keys', () => {
    expect(stripeKeyMode('sk_live_abc')).toBe('live');
    expect(stripeKeyMode('rk_live_abc')).toBe('live');
    expect(stripeKeyMode('sk_test_abc')).toBe('test');
    expect(stripeKeyMode('rk_test_abc')).toBe('test');
  });

  it('treats a missing or foreign key as not configured', () => {
    expect(stripeKeyMode(undefined)).toBeNull();
    expect(stripeKeyMode('pk_live_abc')).toBeNull(); // publishable keys are not secret keys
    expect(stripeKeyMode('whsec_abc')).toBeNull();
  });
});
