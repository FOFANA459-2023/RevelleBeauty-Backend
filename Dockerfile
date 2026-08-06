# Revelle Beauty API — multi-stage production image.
# NOTE: this is a long-lived Express server (raw Postgres TCP, sharp native
# binaries, filesystem uploads). It cannot run on Cloudflare Workers; deploy
# it to a container/Node host. See DEPLOY.md.

# ── build ────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.build.json ./
COPY contracts ./contracts
COPY src ./src
RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only (sharp rebuilds for linux here).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Compiled JS + the SQL the migration runner reads at boot.
COPY --from=build /app/dist ./dist
COPY migrations ./migrations

# Don't run as root.
USER node

EXPOSE 4000

# Migrations are forward-only and applied automatically on start, so a new
# image version upgrades the database itself.
CMD ["node", "dist/src/index.js"]
