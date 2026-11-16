# syntax=docker/dockerfile:1.7
# One image runs the web app, the worker and migrations (selected by command).
# Node 22 LTS, Debian slim (glibc) for @node-rs/argon2 + Prisma engines.

FROM node:22-bookworm-slim AS base
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PRISMA_HIDE_UPDATE_MESSAGE=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/*
# Flaky VPS uplinks: let npm retry registry downloads instead of failing the whole build on one ECONNRESET.
RUN npm config set -g fetch-retries 6 fetch-retry-mintimeout 20000 fetch-retry-maxtimeout 180000 fetch-timeout 900000
WORKDIR /app

# ───── all deps (build) ─────
FROM base AS build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm NODE_ENV=development npm ci --no-audit --no-fund
COPY . .
# Build-time env only needs to satisfy module-load validation; real values come at runtime.
ENV APP_URL=https://build.invalid DATABASE_URL=postgresql://build:build@localhost:5432/build ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= APP_STAGE=local
RUN npx prisma generate && npx next build && npm run build:worker

# ───── production deps only ─────
# Reuse the build stage's node_modules (one registry download per build) and strip dev packages.
FROM base AS prod-deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
COPY --from=build /app/node_modules ./node_modules
RUN npm prune --omit=dev --no-audit --no-fund --ignore-scripts
COPY --from=build /app/src/generated ./src/generated

# ───── runtime ─────
FROM base AS web
ENV PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd -r app && useradd -r -g app -d /app app && mkdir -p /app/storage && chown -R app:app /app
# Next standalone server (self-contained) …
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
# … plus full production node_modules for the worker, migrations and scripts.
COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
# Prisma schema engine downloaded during `prisma generate` in the build stage, so `prisma migrate deploy`
# at container start needs no network and cannot fail on a blocked download.
COPY --from=build --chown=app:app /app/node_modules/prisma ./node_modules/prisma
COPY --from=build --chown=app:app /app/node_modules/@prisma/engines ./node_modules/@prisma/engines
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/prisma.config.ts /app/package.json /app/tsconfig.json ./
COPY --from=build --chown=app:app /app/scripts ./scripts
COPY --from=build --chown=app:app /app/src ./src
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD curl -fsS http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
