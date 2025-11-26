# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy monorepo root files
COPY package*.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

# Copy all workspace packages
COPY packages ./packages
COPY apps/api ./apps/api

# Install ALL dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Build shared packages first, then API
RUN pnpm --filter @spawner/types build && \
    pnpm --filter @spawner/config build && \
    pnpm --filter @spawner/utils build && \
    pnpm --filter @spawner/api build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy monorepo root files
COPY package*.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy all workspace packages (needed for workspace resolution)
COPY packages/types/package.json ./packages/types/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/utils/package.json ./packages/utils/package.json
COPY apps/api/package.json ./apps/api/package.json

# Install ONLY production dependencies
RUN pnpm install --frozen-lockfile --prod

# Copy built packages from builder
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/config/dist ./packages/config/dist
COPY --from=builder /app/packages/utils/dist ./packages/utils/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/auth/status', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "apps/api/dist/main.js"]
