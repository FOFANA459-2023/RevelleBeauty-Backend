import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import type { Pool } from 'pg';
import { env, isProd } from '../../config/env.js';
import { badRequest, conflict, notFound, unauthorized } from '../../lib/errors.js';
import { loginLimiter } from '../../middleware/rateLimit.js';
import {
  SESSION_COOKIE,
  customerId,
  requireCustomer,
  sessionSeconds,
  signSessionToken,
  type Role,
} from '../../middleware/auth.js';

const addressSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).nullish(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().min(1).max(20),
  country: z.string().length(2).default('US'),
});

const registerSchema = z
  .object({
    email: z.string().email().max(200),
    password: z.string().min(8, 'Password must be at least 8 characters').max(200),
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(30).optional(),
  })
  .strict();

const loginSchema = z
  .object({ email: z.string().email().max(200), password: z.string().min(1).max(200) })
  .strict();

const profileSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().max(30).nullish(),
    address: addressSchema.nullish(),
  })
  .strict();

interface CustomerRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: Role;
  phone: string | null;
  addr_line1: string | null;
  addr_line2: string | null;
  addr_city: string | null;
  addr_state: string | null;
  addr_postal_code: string | null;
  addr_country: string | null;
}

function toProfile(c: CustomerRow) {
  return {
    id: c.id,
    email: c.email,
    name: c.name,
    role: c.role,
    phone: c.phone,
    address: c.addr_line1
      ? {
          line1: c.addr_line1,
          line2: c.addr_line2,
          city: c.addr_city,
          state: c.addr_state,
          postalCode: c.addr_postal_code,
          country: c.addr_country?.trim() ?? 'US',
        }
      : null,
  };
}

function startSession(res: import('express').Response, row: CustomerRow): void {
  const expiresInSec = sessionSeconds(row.role);
  res.cookie(SESSION_COOKIE, signSessionToken(row.id, row.role, expiresInSec), {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/api',
    maxAge: expiresInSec * 1000,
  });
}

export function customerAuthRoutes(pool: Pool): Router {
  const r = Router();

  r.post('/register', loginLimiter, async (req, res) => {
    const body = registerSchema.parse(req.body);
    const email = body.email.trim().toLowerCase();

    // The admin identity is seeded at boot — never claimable via registration.
    if (env.ADMIN_EMAIL && email === env.ADMIN_EMAIL.toLowerCase()) {
      throw badRequest('This email cannot be used');
    }

    const hash = await bcrypt.hash(body.password, 12);
    let row: CustomerRow;
    try {
      const { rows } = await pool.query<CustomerRow>(
        `insert into customers (email, password_hash, name, phone)
         values ($1, $2, $3, $4) returning *`,
        [email, hash, body.name, body.phone ?? null],
      );
      row = rows[0]!;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw conflict('An account with this email already exists — sign in instead');
      }
      throw err;
    }

    startSession(res, row);
    res.status(201).json({ customer: toProfile(row) });
  });

  r.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const { rows } = await pool.query<CustomerRow>(
      `select * from customers where email = $1`,
      [email.trim().toLowerCase()],
    );
    const row = rows[0];
    // Compare against a real hash even for unknown emails: constant-ish time.
    const hash = row?.password_hash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalid1234567890';
    const ok = await bcrypt.compare(password, hash);
    if (!row || !ok) throw unauthorized('Invalid email or password');

    startSession(res, row);
    res.json({ customer: toProfile(row) });
  });

  r.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/api' });
    // Pre-unification cookies — clear so stale sessions can't linger.
    res.clearCookie('rb_customer', { path: '/api' });
    res.clearCookie('rb_admin', { path: '/api/admin' });
    res.json({ ok: true });
  });

  r.get('/me', requireCustomer, async (req, res) => {
    const { rows } = await pool.query<CustomerRow>(`select * from customers where id = $1`, [
      customerId(req),
    ]);
    if (!rows[0]) throw notFound('Account not found');
    res.json({ customer: toProfile(rows[0]) });
  });

  r.patch('/profile', requireCustomer, async (req, res) => {
    const patch = profileSchema.parse(req.body);
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };

    if (patch.name !== undefined) push('name', patch.name);
    if (patch.phone !== undefined) push('phone', patch.phone);
    if (patch.address !== undefined) {
      if (patch.address === null) {
        sets.push(
          'addr_line1 = null, addr_line2 = null, addr_city = null, addr_state = null, addr_postal_code = null',
        );
      } else {
        push('addr_line1', patch.address.line1);
        push('addr_line2', patch.address.line2 ?? null);
        push('addr_city', patch.address.city);
        push('addr_state', patch.address.state);
        push('addr_postal_code', patch.address.postalCode);
        push('addr_country', patch.address.country);
      }
    }

    if (sets.length) {
      params.push(customerId(req));
      await pool.query(`update customers set ${sets.join(', ')} where id = $${params.length}`, params);
    }
    const { rows } = await pool.query<CustomerRow>(`select * from customers where id = $1`, [
      customerId(req),
    ]);
    res.json({ customer: toProfile(rows[0]!) });
  });

  return r;
}
