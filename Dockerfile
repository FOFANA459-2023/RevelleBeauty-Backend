# Revelle Beauty API — container image.
# Runs via tsx (TypeScript executor): resolves the @contracts path alias at
# runtime, which plain `node dist/` cannot do without a bundling step.
FROM node:22-slim

WORKDIR /app

# sharp needs these at runtime on slim images
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY contracts ./contracts
COPY migrations ./migrations
COPY src ./src

ENV NODE_ENV=production
EXPOSE 4000

# Migrations run automatically at boot (forward-only, recorded in
# schema_migrations), then the server starts.
CMD ["npx", "tsx", "src/index.ts"]
