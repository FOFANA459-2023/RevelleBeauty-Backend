# Deploying the API (Cloudflare + containers)

## Why this isn't a Cloudflare Worker

The API is a long-lived Express server using Node-native modules (`sharp`
image processing, `pg` TCP connections, raw-body Stripe verification).
Workers' runtime cannot run it as-is. The supported Cloudflare path is
**Cloudflare Containers** (or any container host — Fly.io, Railway, Render —
fronted by Cloudflare DNS/proxy).

## What CI produces

Every green build of `main` publishes a ready-to-run image:

```
ghcr.io/fofana459-2023/revellebeauty-backend:latest
ghcr.io/fofana459-2023/revellebeauty-backend:<git sha>
```

(First time only: make the package public, or grant your host a GHCR pull
token — GitHub → Packages → package settings.)

Migrations are forward-only and run automatically at boot, recorded in
`schema_migrations`, so a new container version upgrades the database itself.

## Required environment variables (set on the host, never in the image)

```
NODE_ENV=production
PORT=4000
FRONTEND_URL=https://yourdomain.com
CORS_ORIGINS=https://yourdomain.com
DATABASE_URL=<Supabase session-pooler URI>
STORAGE_DRIVER=supabase
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<secret>
SUPABASE_STORAGE_BUCKET=product-images
STRIPE_SECRET_KEY=<sk_live_... when ready>
STRIPE_WEBHOOK_SECRET=<whsec_... from the dashboard endpoint>
ADMIN_EMAIL=<admin email>
ADMIN_PASSWORD_HASH=<bcrypt hash>
ADMIN_JWT_SECRET=<openssl rand -base64 48>
```

Production refuses to boot if any of the critical ones are missing — that's
intentional (fail at deploy, not at the first order).

## Routing

Put the container behind Cloudflare and route one of:

- `yourdomain.com/api/*` → container (recommended: same origin as Pages,
  zero CORS, cookies just work), or
- `api.yourdomain.com` → container (same registrable domain keeps the
  SameSite cookies working; set `CORS_ORIGINS` accordingly).

Health check endpoint for the host: `GET /api/health`.

## Stripe webhook (when keys arrive)

Dashboard → Developers → Webhooks → add endpoint
`https://<api host>/api/webhooks/stripe` with events:
`checkout.session.completed`, `checkout.session.expired`,
`checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `charge.refunded` — then put the
signing secret in `STRIPE_WEBHOOK_SECRET`.
