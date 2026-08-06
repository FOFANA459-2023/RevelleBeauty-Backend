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

## Option A — a Node/container host

The `Dockerfile` is the portable artifact (multi-stage, production-only deps,
non-root). It runs anywhere. Three configs ship in this repo:

| File | Host | Sleeps when idle? |
|---|---|---|
| `fly.toml` | Fly.io | **No** — `auto_stop_machines = false` |
| `render.yaml` | Render | Yes, on the free plan (~30–60s cold start) |
| `wrangler.jsonc` | Cloudflare Containers | No (needs Workers Paid) |

### Fly.io (no cold starts)

```bash
fly launch --no-deploy --copy-config    # creates the app from fly.toml
fly secrets set \
  DATABASE_URL="postgresql://..." \
  SUPABASE_SERVICE_ROLE_KEY="..." \
  ADMIN_EMAIL="..." \
  ADMIN_PASSWORD_HASH='$2b$12$...' \
  ADMIN_JWT_SECRET="$(openssl rand -base64 48)" \
  SUPABASE_URL="https://<ref>.supabase.co"
fly deploy
```

`fly.toml` pins the app to **Mumbai (`bom`)** to match the Supabase project's
region. Keep the API and database in the same region — every request is
several round trips, and splitting them across continents undoes the query
optimisation work.

Non-secret values live in the `[env]` block; secrets go through
`fly secrets set` and are never committed.

### Other hosts

Koyeb, Railway, and Google Cloud Run all take the same Dockerfile. Cloud Run
scales to zero but resumes in ~1–2s (not Render's ~30–60s). Oracle Cloud's
Always Free ARM VMs never sleep and cost nothing indefinitely, at the price
of managing the VM yourself.

> Free-tier terms change frequently. Verify current limits before committing
> to a host.

CI already publishes an image to GHCR on every green `main`:

```
ghcr.io/fofana459-2023/revellebeauty-backend:latest
ghcr.io/fofana459-2023/revellebeauty-backend:<git sha>
```

Health check path for any host: `/api/health`.

## Option B — Cloudflare Containers (stay on Cloudflare)

**This repo is already configured for it.** `wrangler.jsonc` + `worker/index.ts`
run the Express server inside a container built from the `Dockerfile`, with a
Worker forwarding every request to it.

### Troubleshooting: image builds, then `✘ [ERROR] Unauthorized`

If the log shows the Docker image building all the way through, the Worker
uploading, and *then* `Unauthorized`, the failure is at the final step —
**pushing the image to Cloudflare's container registry**. Two causes, in
order of likelihood:

1. **The account is not on the Workers Paid plan.** Containers require it.
   Everything up to the registry push works on a free account, which makes
   this failure look like a permissions bug rather than a billing one.
   Check: Dashboard → Workers & Pages → Plans.
2. **The build token lacks container registry access.** If you are already on
   Workers Paid, regenerate the Workers Builds token
   (project → Settings → Build → Build token) or deploy from your machine
   with a token that has **Workers Scripts: Edit**.

If neither applies, deploy locally with `npx wrangler deploy` — the error
message there is usually more specific than the CI one.

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
