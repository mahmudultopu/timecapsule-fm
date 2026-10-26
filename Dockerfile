# syntax=docker/dockerfile:1.7
# Multi-target build for the monorepo:
#   tools   – full workspace (migrations, seed, storage init)
#   api     – Fastify API, production deps only
#   worker  – transcoding worker with ffmpeg, production deps only
#   web     – Next.js standalone server

ARG NODE_IMAGE=node:24.22.1-alpine3.24

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 CI=true
RUN npm install -g pnpm@10.34.9 && npm cache clean --force
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @timecapsule/shared --filter @timecapsule/db --filter @timecapsule/api \
      --filter @timecapsule/worker --filter @timecapsule/web build
RUN pnpm --filter @timecapsule/api deploy --prod --legacy /out/api \
 && pnpm --filter @timecapsule/worker deploy --prod --legacy /out/worker

# ---------- tools (one-shot jobs) ----------
FROM build AS tools
USER node
CMD ["pnpm", "db:migrate"]

# ---------- api ----------
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1
CMD ["node", "dist/server.js"]

# ---------- worker ----------
FROM ${NODE_IMAGE} AS worker
ENV NODE_ENV=production
# ffmpeg from the distribution; no shell is used to invoke it.
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY --from=build --chown=node:node /out/worker ./
USER node
CMD ["node", "dist/main.js"]

# ---------- web ----------
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
