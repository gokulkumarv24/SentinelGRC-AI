# syntax=docker/dockerfile:1.7
# SentinelGRC web app (Next.js standalone). Build from the repository root:
#   docker build -f apps/web/Dockerfile --build-arg API_BASE_URL=http://api:4000 -t sentinelgrc-web .
# API_BASE_URL is compiled into the /api/v1 proxy rewrite at BUILD time — build per environment.
ARG NODE_IMAGE=node:24.15.0-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY services/api/package.json services/api/
RUN npm ci --workspace apps/web --include-workspace-root --ignore-scripts

FROM deps AS build
ARG API_BASE_URL=http://api:4000
ENV API_BASE_URL=${API_BASE_URL} NEXT_TELEMETRY_DISABLED=1
COPY apps/web apps/web
RUN mkdir -p apps/web/public && npm run build --workspace apps/web

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
# npm/corepack are not needed at runtime; removing them drops their bundled dependencies (e.g. tar).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
