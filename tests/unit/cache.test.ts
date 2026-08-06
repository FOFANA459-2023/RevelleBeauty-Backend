import { describe, expect, it } from 'vitest';
import { cached, invalidateCatalog } from '../../src/lib/cache.js';

describe('cache', () => {
  it('returns the cached value within TTL without re-running the loader', async () => {
    let calls = 0;
    const load = async () => ++calls;
    const a = await cached('catalog:test:a', 60_000, load);
    const b = await cached('catalog:test:a', 60_000, load);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(calls).toBe(1);
  });

  it('expires entries after TTL', async () => {
    let calls = 0;
    const load = async () => ++calls;
    await cached('catalog:test:ttl', 1, load);
    await new Promise((r) => setTimeout(r, 10));
    await cached('catalog:test:ttl', 1, load);
    expect(calls).toBe(2);
  });

  it('invalidateCatalog drops all catalog entries', async () => {
    let calls = 0;
    const load = async () => ++calls;
    await cached('catalog:test:inv', 60_000, load);
    invalidateCatalog();
    await cached('catalog:test:inv', 60_000, load);
    expect(calls).toBe(2);
  });

  it('does not cache a failed load', async () => {
    let calls = 0;
    const bad = async () => {
      calls++;
      throw new Error('boom');
    };
    await expect(cached('catalog:test:fail', 60_000, bad)).rejects.toThrow('boom');
    await expect(cached('catalog:test:fail', 60_000, bad)).rejects.toThrow('boom');
    expect(calls).toBe(2);
  });

  it('SECURITY: refuses any key outside the public catalog namespace', async () => {
    await expect(cached('customers:1', 1000, async () => 'x')).rejects.toThrow(/never be cached/);
    await expect(cached('orders:1', 1000, async () => 'x')).rejects.toThrow(/never be cached/);
    await expect(cached('session:abc', 1000, async () => 'x')).rejects.toThrow(/never be cached/);
    // no sneaking past with a prefix-ish name
    await expect(cached('catalogx:1', 1000, async () => 'x')).rejects.toThrow(/never be cached/);
  });
});
