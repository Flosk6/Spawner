# Monorepo Migration Guide

This document explains the changes made to transform Spawner into a modern monorepo architecture.

## What Changed?

### Directory Structure

**Before:**
```
spawner/
├── backend/
├── frontend/
└── project.config.yml
```

**After:**
```
spawner/
├── apps/
│   ├── api/              (was backend/)
│   └── web/              (was frontend/)
├── packages/
│   ├── types/            (NEW - shared types)
│   ├── config/           (NEW - shared config)
│   └── utils/            (NEW - shared utilities)
├── pnpm-workspace.yaml   (NEW)
├── turbo.json            (NEW)
└── package.json          (NEW - root)
```

### Package Manager

- **Before**: npm (individual package.json in backend/frontend)
- **After**: pnpm with workspaces (monorepo management)

### Build System

- **Before**: Independent npm scripts
- **After**: Turborepo with intelligent caching and parallel execution

## Installation Steps

### 1. Remove Old Dependencies

```bash
# Clean old node_modules and lock files
rm -rf backend/node_modules frontend/node_modules
rm -f backend/package-lock.json frontend/package-lock.json
```

### 2. Install pnpm

```bash
npm install -g pnpm@latest
```

### 3. Install All Dependencies

```bash
# From the root directory
pnpm install
```

This will:
- Install dependencies for all apps
- Install dependencies for all packages
- Link workspace packages automatically

### 4. Build Shared Packages

```bash
pnpm build
```

This builds the shared packages first, then the apps.

## Key Benefits

### 1. Shared Code

No more code duplication! Common types, utilities, and configurations are now in shared packages:

```typescript
// Before (duplicated types in backend and frontend)
// backend/src/types.ts
export type ResourceType = 'laravel-api' | 'nextjs-front' | 'mysql-db';

// frontend/src/types/index.ts
export type ResourceType = 'laravel-api' | 'nextjs-front' | 'mysql-db';

// After (single source of truth)
// packages/types/src/index.ts
export type ResourceType = 'laravel-api' | 'nextjs-front' | 'mysql-db';

// Both apps import from shared package
import type { ResourceType } from '@spawner/types';
```

### 2. Faster Builds

Turborepo caches build outputs. First build might take 30s, subsequent builds take <1s if nothing changed!

```bash
# First build
$ pnpm build
# ➤ Takes ~30s

# Second build (no changes)
$ pnpm build
# ➤ Takes <1s (cached!)

# Change only frontend
$ pnpm build
# ➤ Only rebuilds @spawner/web (~5s)
```

### 3. Better Developer Experience

```bash
# Start everything in dev mode
pnpm dev

# Start only what you need
pnpm api:dev
pnpm web:dev

# Add dependencies with filters
pnpm --filter @spawner/api add lodash
pnpm --filter @spawner/web add axios
```

### 4. Type Safety Across Apps

Frontend and backend now share the same types, reducing bugs:

```typescript
// API defines the type
import type { Environment } from '@spawner/types';

// Frontend uses the exact same type
import type { Environment } from '@spawner/types';

// TypeScript ensures they match!
```

## Common Commands

### Development

```bash
pnpm dev                    # Start all apps in dev mode
pnpm api:dev                # Start only API
pnpm web:dev                # Start only Web UI
```

### Building

```bash
pnpm build                  # Build everything
pnpm api:build              # Build only API
pnpm web:build              # Build only Web UI
```

### Managing Dependencies

```bash
# Add to root (dev tools like turbo)
pnpm add -w <package>

# Add to specific app
pnpm --filter @spawner/api add <package>
pnpm --filter @spawner/web add <package>

# Add to shared package
pnpm --filter @spawner/types add <package>
```

### Cleaning

```bash
pnpm clean                  # Clean all build artifacts
rm -rf node_modules         # Remove all dependencies
pnpm install                # Reinstall everything
```

## Troubleshooting

### Issue: "Cannot find module '@spawner/types'"

**Solution**: Build the shared packages first
```bash
pnpm --filter @spawner/types build
pnpm --filter @spawner/config build
pnpm --filter @spawner/utils build
# Or build everything
pnpm build
```

### Issue: "Workspace not found"

**Solution**: Make sure you're running commands from the root directory

### Issue: Build is slow

**Solution**: Turborepo should cache builds. If it's slow:
```bash
# Clear cache and rebuild
rm -rf .turbo
pnpm build
```

### Issue: Types not updating

**Solution**: Rebuild the types package
```bash
pnpm --filter @spawner/types build
```

## What Stays the Same?

- **Docker Compose** setup remains unchanged
- **Project configuration** (project.config.yml) remains the same
- **API endpoints** and contracts remain unchanged
- **Environment variables** remain the same
- **Git workflow** remains unchanged

## Next Steps

1. Update your CI/CD pipelines to use pnpm
2. Consider adding more shared packages (e.g., @spawner/ui-components)
3. Add tests to shared packages
4. Set up changesets for versioning (optional)

## Need Help?

Check the main [README.md](README.md) for detailed documentation on the new structure.
