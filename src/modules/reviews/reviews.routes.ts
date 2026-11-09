import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import type {
  AdminReviewDTO,
  MyReviewDTO,
  ProductReviewsResponse,
  ReviewDTO,
} from '@contracts/index';
import { withId, withSlug } from '../../middleware/validateParams.js';
import { customerId, requireCustomer } from '../../middleware/auth.js';
import { reviewLimiter } from '../../middleware/rateLimit.js';
import { notFound } from '../../lib/errors.js';
import { invalidateCatalog } from '../../lib/cache.js';

/**
 * Product reviews. Everything shown is written by a signed-in customer; there
 * is no way to post a review without an account, and no way for the API to
 * mark one "verified" on request: that badge is worked out from paid orders.
 */

/* ---------- input ---------- */

// Control characters (other than newlines and tabs) never belong in a review.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const clean = (s: string) => s.replace(CONTROL, '').replace(/\r\n?/g, '\n').trim();

export const reviewInputSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    title: z
      .string()
      .max(400)
      .transform(clean)
      .pipe(z.string().max(120))
      .nullish()
      .transform((t) => (t ? t : null)),
    body: z.string().max(8000).transform(clean).pipe(z.string().min(10).max(2000)),
  })
  .strict();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  sort: z.enum(['newest', 'highest', 'lowest']).default('newest'),
});

const SORTS = {
  newest: 'r.created_at desc',
  highest: 'r.rating desc, r.created_at desc',
  lowest: 'r.rating asc, r.created_at desc',
} as const;

const adminListSchema = z.object({
  status: z.enum(['published', 'hidden']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const adminUpdateSchema = z.object({ status: z.enum(['published', 'hidden']) }).strict();

/* ---------- output ---------- */

/** "Amara Johnson" -> "Amara J."; a single name stays as it is. */
export function displayName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Revelle customer';
  const first = parts[0]!.slice(0, 40);
  if (parts.length === 1) return first;
  return `${first} ${parts[parts.length - 1]!.charAt(0).toUpperCase()}.`;
}

interface ReviewRow {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  customer_name: string;
  verified: boolean;
  created_at: Date;
  product_slug: string;
  product_name: string;
  status: 'published' | 'hidden';
  customer_email: string;
  total?: string;
}

const REVIEW_SELECT = `
  select r.id, r.rating, r.title, r.body, r.status, r.created_at,
         c.name as customer_name, c.email::text as customer_email,
         p.slug as product_slug, p.name as product_name,
         exists (
           select 1 from order_items oi
             join orders o on o.id = oi.order_id
            where o.customer_id = r.customer_id
              and oi.product_id = r.product_id
              and o.status in ('paid', 'fulfilled')
         ) as verified
    from product_reviews r
    join customers c on c.id = r.customer_id
    join products p on p.id = r.product_id
`;

function toReview(r: ReviewRow, withProduct = false): ReviewDTO {
  return {
    id: r.id,
    rating: r.rating,
    title: r.title,
    body: r.body,
    author: displayName(r.customer_name),
    verifiedPurchase: r.verified,
    createdAt: r.created_at.toISOString(),
    ...(withProduct ? { product: { slug: r.product_slug, name: r.product_name } } : {}),
  };
}

/* ---------- helpers ---------- */

async function productIdBySlug(pool: Pool, slug: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from products where slug = $1 and status = 'active'`,
    [slug],
  );
  if (!rows[0]) throw notFound('Product not found');
  return rows[0].id;
}

/** Reviews change on every post; never let a browser or proxy hold an old list. */
function fresh(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-cache');
  next();
}

function personal(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'private, no-store');
  next();
}

/* ---------- storefront ---------- */

export function reviewRoutes(pool: Pool): Router {
  const r = Router();

  r.get('/products/:slug/reviews', withSlug, fresh, async (req, res) => {
    const q = listQuerySchema.parse(req.query);
    const productId = await productIdBySlug(pool, req.params.slug);

    const [{ rows }, { rows: stats }] = await Promise.all([
      pool.query<ReviewRow>(
        `${REVIEW_SELECT}
          where r.product_id = $1 and r.status = 'published'
          order by ${SORTS[q.sort]}
          limit $2 offset $3`,
        [productId, q.limit, q.offset],
      ),
      pool.query<{ rating: number; n: number }>(
        `select rating, count(*)::int as n from product_reviews
          where product_id = $1 and status = 'published'
          group by rating`,
        [productId],
      ),
    ]);

    const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    for (const s of stats) distribution[s.rating - 1] = s.n;
    const total = distribution.reduce((a, b) => a + b, 0);
    const sum = distribution.reduce((a, n, i) => a + n * (i + 1), 0);

    const body: ProductReviewsResponse = {
      summary: total > 0
        ? { average: Math.round((sum / total) * 10) / 10, count: total, distribution }
        : null,
      reviews: rows.map((row) => toReview(row)),
      total,
    };
    res.json(body);
  });

  /** The homepage's "from the community": real four- and five-star reviews, newest first. */
  r.get('/reviews/recent', fresh, async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(6).default(3).parse(req.query.limit);
    const { rows } = await pool.query<ReviewRow>(
      `${REVIEW_SELECT}
        where r.status = 'published' and r.rating >= 4 and p.status = 'active'
        order by r.created_at desc
        limit $1`,
      [limit],
    );
    res.json({ reviews: rows.map((row) => toReview(row, true)) });
  });

  /* ----- the signed-in customer's own review ----- */

  r.get('/products/:slug/reviews/mine', withSlug, personal, requireCustomer, async (req, res) => {
    const productId = await productIdBySlug(pool, req.params.slug);
    const { rows } = await pool.query<MyReviewDTO>(
      `select id, rating, title, body, status from product_reviews
        where product_id = $1 and customer_id = $2`,
      [productId, customerId(req)],
    );
    res.json({ review: rows[0] ?? null });
  });

  r.put(
    '/products/:slug/reviews/mine',
    withSlug,
    personal,
    requireCustomer,
    reviewLimiter,
    async (req, res) => {
      const input = reviewInputSchema.parse(req.body);
      const productId = await productIdBySlug(pool, req.params.slug);
      // One review per customer per product: posting again edits it. A review
      // an admin hid stays hidden when edited; editing is not an appeal.
      const { rows } = await pool.query<MyReviewDTO>(
        `insert into product_reviews (product_id, customer_id, rating, title, body)
         values ($1, $2, $3, $4, $5)
         on conflict (product_id, customer_id) do update
           set rating = excluded.rating, title = excluded.title, body = excluded.body
         returning id, rating, title, body, status`,
        [productId, customerId(req), input.rating, input.title, input.body],
      );
      invalidateCatalog(); // card and page ratings are cached with the catalog
      res.json({ review: rows[0] });
    },
  );

  r.delete('/products/:slug/reviews/mine', withSlug, personal, requireCustomer, async (req, res) => {
    const productId = await productIdBySlug(pool, req.params.slug);
    await pool.query(
      `delete from product_reviews where product_id = $1 and customer_id = $2`,
      [productId, customerId(req)],
    );
    invalidateCatalog();
    res.status(204).end();
  });

  return r;
}

/* ---------- admin moderation (mounted behind requireAdmin) ---------- */

export function adminReviewRoutes(pool: Pool): Router {
  const r = Router();

  r.get('/reviews', async (req, res) => {
    const q = adminListSchema.parse(req.query);
    const params: unknown[] = [];
    let where = 'true';
    if (q.status) {
      params.push(q.status);
      where = `r.status = $1`;
    }
    params.push(q.limit, q.offset);
    const { rows } = await pool.query<ReviewRow>(
      `${REVIEW_SELECT.replace('select r.id,', 'select count(*) over() as total, r.id,')}
        where ${where}
        order by r.created_at desc
        limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    const reviews: AdminReviewDTO[] = rows.map((row) => ({
      ...toReview(row),
      status: row.status,
      customerEmail: row.customer_email,
      product: { slug: row.product_slug, name: row.product_name },
    }));
    res.json({ reviews, total: rows.length ? Number(rows[0]!.total) : 0 });
  });

  r.patch('/reviews/:id', withId, async (req, res) => {
    const { status } = adminUpdateSchema.parse(req.body);
    const { rowCount } = await pool.query(
      `update product_reviews set status = $1 where id = $2`,
      [status, req.params.id],
    );
    if (!rowCount) throw notFound('Review not found');
    res.json({ ok: true });
  });

  r.delete('/reviews/:id', withId, async (req, res) => {
    const { rowCount } = await pool.query(`delete from product_reviews where id = $1`, [req.params.id]);
    if (!rowCount) throw notFound('Review not found');
    res.status(204).end();
  });

  return r;
}
