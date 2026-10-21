# syntax=docker/dockerfile:1.7
# SentinelGRC API, worker and release (migration) images. Build from the repository root:
#   docker build -f services/api/Dockerfile --target runtime -t sentinelgrc-api .
#   docker build -f services/api/Dockerfile --target release -t sentinelgrc-release .
ARG NODE_IMAGE=node:24.15.0-bookworm-slim

# ── Dependencies (all, for building) ─────────────────────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY services/api/package.json services/api/prisma.config.ts services/api/
COPY services/api/prisma services/api/prisma
RUN npm ci --workspace services/api --include-workspace-root

# ── Build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY services/api services/api
RUN npm run build --workspace services/api

# ── Production dependencies only ─────────────────────────────────────────────
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
ENV npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY services/api/package.json services/api/
# Scripts are skipped: the Prisma client is generated and compiled into dist/ at build time.
RUN npm ci --workspace services/api --omit=dev --ignore-scripts \
 && mkdir -p services/api/node_modules

# ── Runtime: API (default) and worker (`node dist/worker.js`) ────────────────
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production APP_ENV=production LOCAL_STORAGE_PATH=/app/var/storage
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/services/api/node_modules ./services/api/node_modules
COPY --from=build /app/services/api/dist ./services/api/dist
COPY package.json ./
COPY services/api/package.json ./services/api/
COPY framework-data ./framework-data
# Private evidence/report storage lives on a mounted volume, never in a web root.
RUN mkdir -p /app/var/storage && chown -R node:node /app/var
USER node
WORKDIR /app/services/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ── Release: run once per deploy, before new API/worker containers start ─────
FROM build AS release
COPY framework-data /app/framework-data
RUN chown -R node:node /app/services/api
USER node
WORKDIR /app/services/api
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/cli/sync-reference.js"]
