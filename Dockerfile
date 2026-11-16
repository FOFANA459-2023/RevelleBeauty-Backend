# syntax=docker/dockerfile:1.7
# Revelle Beauty API — multi-stage production image.
# A long-lived Express server (raw Postgres TCP, sharp native binaries), so
# it runs on a container host, not Cloudflare Workers. See DEPLOY.md.
#
# Supply chain: the base image is pinned by digest, so every build starts
# from exactly the same bytes (Dependabot proposes digest bumps). CI scans the
# result with Trivy, smoke-tests it, and signs it before anything is pushed.

ARG NODE_IMAGE=node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee

# ── build ────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.build.json ./
COPY contracts ./contracts
COPY src ./src
RUN npm run build

# ── production dependencies (sharp fetches its linux binary here) ────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ── runtime ──────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime

# OS security patches released since the base image was cut. Then npm and
# corepack go: the server never installs anything at runtime, and a package
# manager in the image is attack surface plus its own stream of CVEs.
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

WORKDIR /app
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps

COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/dist ./dist
COPY --chown=root:root package.json ./
# The SQL the migration runner reads at boot (forward-only, applied on start).
COPY --chown=root:root migrations ./migrations

# Code is owned by root and read-only to the app user: a compromised process
# cannot rewrite the server. Only the uploads directory is writable.
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

LABEL org.opencontainers.image.title="revelle-beauty-api" \
      org.opencontainers.image.description="Revelle Beauty storefront API" \
      org.opencontainers.image.licenses="UNLICENSED"

CMD ["node", "dist/src/index.js"]
