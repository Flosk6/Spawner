# syntax=docker/dockerfile:1

# Single Spawner image: NestJS API + Vue interface served on the same origin.

FROM node:22-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@8.15.0

FROM base AS build
ENV TURBO_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @spawner/api exec prisma generate
RUN pnpm build
RUN pnpm --filter @spawner/api --prod deploy /out \
 && cd /out \
 && ./node_modules/.bin/prisma generate

FROM base AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client tini \
 && rm -rf /var/lib/apt/lists/*
COPY --from=docker:29-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:29-cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins
WORKDIR /app
COPY --from=build --chown=node:node /out ./
COPY --from=build --chown=node:node /repo/apps/web/dist ./web
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_PATH=/app/web
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/v1/healthz', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
