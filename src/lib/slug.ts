import type { Pool } from 'pg';

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** Append -2, -3, ... until the slug is free in the given table/column scope. */
export async function ensureUniqueSlug(
  pool: Pool,
  table: 'products' | 'categories',
  base: string,
  excludeId?: string,
): Promise<string> {
  const root = slugify(base) || 'item';
  let candidate = root;
  for (let i = 2; i < 100; i++) {
    const { rows } = await pool.query(
      `select 1 from ${table} where slug = $1 and ($2::uuid is null or id <> $2) limit 1`,
      [candidate, excludeId ?? null],
    );
    if (rows.length === 0) return candidate;
    candidate = `${root}-${i}`;
  }
  throw new Error(`Could not find a free slug for "${base}"`);
}
