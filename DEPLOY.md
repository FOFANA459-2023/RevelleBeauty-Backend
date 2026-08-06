# Deploying the API

## ⚠️ This cannot run on Cloudflare Workers

If you point Cloudflare Workers Builds at this repo, the deploy fails with:

```
✘ [ERROR] Could not detect a directory containing static files
          (e.g. html, css and js) for the project
```

That is not a misconfiguration you can fix with a `wrangler.jsonc`. Wrangler
found no Worker config, fell back to "maybe this is a static site", and found
no HTML — because this is an Express **API**, not a website.

The runtime is genuinely incompatible:

| This API uses | Workers runtime |
|---|---|
| `app.listen()` — a long-lived server | Request-scoped isolates, no listening socket |
| `pg` — raw TCP to Postgres | No arbitrary TCP (needs Hyperdrive + a different driver) |
| `sharp` — native libvips binary | No native Node addons |
| Filesystem uploads, boot-time migrations | No filesystem, no boot phase |

Porting it would mean rewriting to Hono + Hyperdrive + Cloudflare Images —
a rewrite, not a config change. **Disconnect this repo from Cloudflare
Workers Builds** and use one of the options below.

## Option A — a Node/container host (recommended)

Any of Render, Railway, Fly.io, or Koyeb. The repo ships two artifacts so
you're not locked in:

- **`Dockerfile`** — multi-stage, production-only deps, runs as non-root.
  Works on any Docker host.
- **`render.yaml`** — a ready blueprint if you use Render (has a free tier).
  On Render: **New → Blueprint → pick this repo**, then fill in the prompted
  secrets. Nothing sensitive lives in the file.

CI already publishes an image to GHCR on every green `main`:

```
ghcr.io/fofana459-2023/revellebeauty-backend:latest
ghcr.io/fofana459-2023/revellebeauty-backend:<git sha>
```

Health check path for the host: `/api/health`.

> Free tiers usually sleep after inactivity, so the first request after a
> quiet spell can take ~30–60s. Fine for launch, worth upgrading before you
> advertise the store.

## Option B — Cloudflare Containers (stay on Cloudflare)

**This repo is already configured for it.** `wrangler.jsonc` + `worker/index.ts`
run the Express server inside a container built from the `Dockerfile`, with a
Worker forwarding every request to it.

### Prerequisites

1. **Workers Paid plan** ($5/mo minimum) — Containers are not on the free tier.
2. **Docker installed and running locally** — wrangler builds the image on your
   machine and pushes it to Cloudflare's registry. (Or let CI do it.)
3. An API token with **Workers Scripts: Edit**.

### Deploy

```bash
# 1. Secrets — never in wrangler.jsonc, never in git
npx wrangler secret put DATABASE_URL                 # Supabase pooler URI
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD_HASH          # bcrypt hash, not plaintext
npx wrangler secret put ADMIN_JWT_SECRET             # openssl rand -base64 48

# Optional, once you have Stripe:
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET

# 2. Non-secret values live in the "vars" block of wrangler.jsonc —
#    update FRONTEND_URL / CORS_ORIGINS to your real domain first.

# 3. Ship it
npx wrangler deploy
```

Then point the storefront at it (in the **frontend** repo):

```bash
npx wrangler deploy --var API_ORIGIN:https://revelle-api.<your-subdomain>.workers.dev
```

### Notes

- The container sleeps after 15 minutes idle (`sleepAfter` in
  `worker/index.ts`); the next request cold-starts it and re-runs migrations,
  which is safe because they are forward-only. Raise it if cold starts become
  noticeable.
- `max_instances: 1` keeps one warm Postgres pool. To scale, raise it and
  shard the id in `getContainer(...)`.
- Container logs: `npx wrangler tail`.

### Launching before Stripe exists

The server boots fine without Stripe keys — it logs a warning and checkout
returns a clear 503, so you can put a browsable storefront live and add
payments later. It will **refuse** to boot without `DATABASE_URL`,
`ADMIN_PASSWORD_HASH`, or `ADMIN_JWT_SECRET`, because running production with
a default admin secret would let anyone mint an admin session.

## Required environment variables

Set these on the host — never bake them into the image:

```
NODE_ENV=production
PORT=4000                       # most hosts inject their own; the app reads it
FRONTEND_URL=https://revellebeauty.com
CORS_ORIGINS=https://revellebeauty.com
DATABASE_URL=<Supabase session-pooler URI>
STORAGE_DRIVER=supabase
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<secret>
SUPABASE_STORAGE_BUCKET=product-images
ADMIN_EMAIL=<admin email>
ADMIN_PASSWORD_HASH=<bcrypt hash — never the plaintext>
ADMIN_JWT_SECRET=<openssl rand -base64 48>
STRIPE_SECRET_KEY=<sk_live_... when ready>
STRIPE_WEBHOOK_SECRET=<whsec_... from the dashboard endpoint>
```

Production refuses to boot if a critical one is missing — deliberately, so
failures happen at deploy time rather than on the first customer order.

Migrations run automatically at boot (forward-only, tracked in
`schema_migrations`), so deploying a new version upgrades the database.

## Connecting the storefront

Once the API has a public URL, point the frontend Worker at it:

```bash
# in the frontend repo
npx wrangler deploy --var API_ORIGIN:https://revelle-api.onrender.com
```

The frontend Worker proxies `/api/*` and `/uploads/*` to that origin, so the
browser only ever sees one domain. **This is required, not cosmetic:** the
session cookies are `SameSite=Lax`/`Strict` and would never be sent to a
different site, so a split-origin setup silently breaks login and checkout.

## Stripe webhook (when keys arrive)

Dashboard → Developers → Webhooks → add endpoint
`https://<api host>/api/webhooks/stripe`, events: `checkout.session.completed`,
`checkout.session.expired`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `charge.refunded`. Put the signing
secret in `STRIPE_WEBHOOK_SECRET`.
