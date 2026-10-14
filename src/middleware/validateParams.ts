import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';

/**
 * Path parameters are request input like any other, and until this they were
 * the one kind that reached SQL unchecked. A malformed uuid made Postgres
 * raise 22P02, which surfaced as a 500 — a client's mistake reported as a
 * server fault, and a free way to fill the error log. A slug of arbitrary
 * length reached query planning and cache keys.
 *
 * Validating here means a bad param is a 400 from the edge of the request,
 * before the database, the cache or a service ever sees it.
 */

/** Database identity: anything else cannot name a row, so do not ask. */
export const uuidParam = z.string().uuid();

/**
 * Catalog identity. Same shape the admin enforces when it writes a slug, with
 * a length ceiling so a long string can never become a cache key.
 */
export const slugParam = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/**
 * Validates the named path params against a schema each. Mounted per route, so
 * every `:id` and `:slug` is declared where it is used.
 */
export function validateParams<P = Record<string, string>>(
  shape: Record<string, z.ZodType<string>>,
): RequestHandler<P> {
  const schema = z.object(shape);
  return (req: Request<P>, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(result.error);
      return;
    }
    next();
  };
}

/**
 * The two shapes used across the app, named so routes read as intent. The
 * param type is spelled out so Express still infers the handler's own params
 * from the path literal when the guard sits in front of it.
 */
export const withId: RequestHandler<{ id: string }> = validateParams({ id: uuidParam });
export const withSlug: RequestHandler<{ slug: string }> = validateParams({ slug: slugParam });
