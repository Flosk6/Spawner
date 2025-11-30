# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools needed for node-pty and other native modules
RUN apk add --no-cache python3 py3-setuptools make g++

# Install pnpm
RUN npm install -g pnpm

# Copy monorepo root files
COPY package*.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./

# Copy all workspace packages
COPY packages ./packages
COPY apps/api ./apps/api

# Install ALL dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Generate Prisma Client
RUN cd apps/api && pnpm exec prisma generate

# Build shared packages first, then API
RUN pnpm --filter @spawner/types build && \
    pnpm --filter @spawner/config build && \
    pnpm --filter @spawner/utils build && \
    pnpm --filter @spawner/api build

# Production stage
FROM node:20-slim

WORKDIR /app

# Install build tools needed for node-pty and other native modules
# Also install OpenSSL for Prisma compatibility and git for repository cloning
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    openssl \
    ca-certificates \
    git \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm

# Copy monorepo root files
COPY package*.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy all workspace packages (needed for workspace resolution)
COPY packages/types/package.json ./packages/types/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/utils/package.json ./packages/utils/package.json
COPY apps/api/package.json ./apps/api/package.json

# Copy Prisma schema
COPY apps/api/prisma ./apps/api/prisma

# Install dependencies (including devDependencies for Prisma CLI and other tools)
RUN pnpm install --frozen-lockfile

# Generate Prisma Client
RUN cd apps/api && pnpm exec prisma generate

# Copy built packages from builder
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/config/dist ./packages/config/dist
COPY --from=builder /app/packages/utils/dist ./packages/utils/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Copy entrypoint script
COPY apps/api/docker-entrypoint.sh /app/docker-entrypoint.sh

# Use existing user with UID 1000 (usually 'node' in node base image)
# and add to docker group (GID 988) for Docker socket access
RUN groupadd -g 988 docker && \
    usermod -aG docker node && \
    chown -R node:node /app && \
    chmod +x /app/docker-entrypoint.sh

USER node

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/auth/status', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application with entrypoint script
CMD ["/app/docker-entrypoint.sh"]
