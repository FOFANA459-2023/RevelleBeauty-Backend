/**
 * In-memory TTL cache for PUBLIC CATALOG DATA ONLY.
 *
 * ── SECURITY CONTRACT ─────────────────────────────────────────────────
 * Nothing personal may ever enter this cache: no customer rows, no
 * orders, no sessions, no admin data, no emails, no addresses. Allowed
 * keys are namespaced and enforced below — attempting to cache outside
 * the allowed namespaces throws in every environment.
 * ──────────────────────────────────────────────────────────────────────
 *
 * Invalidation: admin mutations and paid orders call invalidateCatalog().
 * TTL is the backstop for anything missed.
 */

const ALLOWED_NAMESPACES = ['catalog'] as const;

interface Entry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, Entry>();

let hits = 0;
let misses = 0;

function assertAllowed(key: string): void {
  if (!ALLOWED_NAMESPACES.some((ns) => key.startsWith(`${ns}:`))) {
    throw new Error(
      `cache: key "${key}" is outside the allowed public namespaces (${ALLOWED_NAMESPACES.join(', ')}). ` +
        'Personal or sensitive data must never be cached.',
    );
  }
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  assertAllowed(key);
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    hits++;
    return hit.value as T;
  }
  misses++;
  const value = await loader();
  store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

/** Drop every catalog entry — called after any admin write or paid order. */
export function invalidateCatalog(): void {
  for (const key of store.keys()) {
    if (key.startsWith('catalog:')) store.delete(key);
  }
}

export function cacheStats(): { size: number; hits: number; misses: number } {
  return { size: store.size, hits, misses };
}

// Opportunistic sweep so long-dead entries don't accumulate.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}, 5 * 60_000).unref();
