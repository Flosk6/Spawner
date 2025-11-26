# Spawner Monorepo Architecture

This document provides an in-depth look at Spawner's monorepo architecture, following 2025 best practices for NestJS and Vue.js applications.

## Architecture Overview

Spawner uses a **pnpm workspaces + Turborepo** monorepo setup, which is the industry-standard approach for modern TypeScript/JavaScript projects as of 2025.

## Why Monorepo?

### Benefits

1. **Code Sharing**: Share types, utilities, and configuration between frontend and backend
2. **Atomic Changes**: Make changes across multiple packages in a single commit
3. **Consistent Tooling**: Single linting, formatting, and testing configuration
4. **Simplified Dependencies**: One lockfile, one node_modules (with hoisting)
5. **Better TypeScript Experience**: IDE can understand the entire codebase
6. **Faster CI/CD**: Turborepo's caching makes builds incredibly fast

### Why pnpm?

- **Disk Space Efficient**: Uses content-addressable storage, saving GBs of disk space
- **Fast**: 2x faster than npm, faster than yarn
- **Strict**: Prevents phantom dependencies (accessing packages you didn't explicitly install)
- **Workspace Support**: First-class monorepo support

### Why Turborepo?

- **Intelligent Caching**: Never rebuild unchanged packages
- **Parallel Execution**: Runs tasks in parallel when possible
- **Incremental Builds**: Only builds what changed
- **Pipeline Configuration**: Define task dependencies declaratively
- **Remote Caching**: Share cache across team (optional, not configured yet)

## Directory Structure

```
spawner/
├── apps/                           # Application packages
│   ├── api/                        # NestJS backend
│   │   ├── src/
│   │   │   ├── modules/            # Feature modules
│   │   │   ├── entities/           # TypeORM entities
│   │   │   ├── common/             # Shared utilities
│   │   │   └── main.ts             # Entry point
│   │   ├── package.json            # Dependencies
│   │   ├── tsconfig.json           # TypeScript config
│   │   └── nest-cli.json           # NestJS config
│   │
│   └── web/                        # Vue.js frontend
│       ├── src/
│       │   ├── components/         # Vue components
│       │   ├── views/              # Page views
│       │   ├── router/             # Vue Router
│       │   ├── services/           # API services
│       │   └── main.ts             # Entry point
│       ├── package.json            # Dependencies
│       ├── vite.config.ts          # Vite config
│       └── tsconfig.json           # TypeScript config
│
├── packages/                       # Shared packages
│   ├── types/                      # @spawner/types
│   │   ├── src/
│   │   │   └── index.ts            # Type definitions
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── config/                     # @spawner/config
│   │   ├── src/
│   │   │   └── index.ts            # Config constants
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── utils/                      # @spawner/utils
│       ├── src/
│       │   └── index.ts            # Utility functions
│       ├── package.json
│       └── tsconfig.json
│
├── .vscode/                        # VSCode settings
│   ├── extensions.json             # Recommended extensions
│   └── settings.json               # Editor config
│
├── pnpm-workspace.yaml             # Workspace definition
├── turbo.json                      # Turborepo pipeline
├── tsconfig.base.json              # Base TypeScript config
├── package.json                    # Root package.json
├── .npmrc                          # pnpm configuration
└── .gitignore                      # Git ignore rules
```

## Package Overview

### Apps

#### @spawner/api (apps/api)

NestJS backend application providing the REST API.

**Key Technologies:**
- NestJS 10+
- TypeORM
- SQLite
- Docker SDK

**Dependencies:**
- `@spawner/types`: Shared type definitions
- `@spawner/config`: Configuration constants
- `@spawner/utils`: Utility functions

**Scripts:**
- `pnpm dev`: Start in watch mode
- `pnpm build`: Build for production
- `pnpm start`: Start production server
- `pnpm lint`: Run ESLint
- `pnpm format`: Format code with Prettier

#### @spawner/web (apps/web)

Vue.js 3 frontend application with Composition API.

**Key Technologies:**
- Vue 3 + Composition API
- Vue Router 4
- Vite 5
- Tailwind CSS 3
- Axios

**Dependencies:**
- `@spawner/types`: Shared type definitions
- `@spawner/config`: Configuration constants
- `@spawner/utils`: Utility functions

**Scripts:**
- `pnpm dev`: Start Vite dev server
- `pnpm build`: Build for production
- `pnpm preview`: Preview production build
- `pnpm lint`: Run ESLint
- `pnpm format`: Format code with Prettier

### Packages

#### @spawner/types (packages/types)

Shared TypeScript type definitions used across the monorepo.

**Exports:**
- `ResourceType`: Union type for resource types
- `EnvironmentStatus`: Union type for environment statuses
- `ProjectConfig`: Project configuration interface
- `Environment`: Environment entity interface
- `EnvironmentResource`: Resource entity interface
- And many more...

**Usage:**
```typescript
import type { Environment, ResourceType } from '@spawner/types';
```

#### @spawner/config (packages/config)

Configuration constants, defaults, and resource configurations.

**Exports:**
- `ENV_VARS`: Environment variable names
- `DEFAULTS`: Default values (ports, passwords, etc.)
- `VALIDATION`: Regex patterns for validation
- `DOCKER`: Docker-related constants
- `RESOURCE_CONFIGS`: Resource type configurations
- Helper functions: `isGitResource()`, `requiresDatabase()`, etc.

**Usage:**
```typescript
import { VALIDATION, ENV_VARS, isGitResource } from '@spawner/config';
```

#### @spawner/utils (packages/utils)

Utility functions for validation, URL generation, and data manipulation.

**Exports:**
- Validation: `validateEnvironmentName()`, `validateBranchName()`
- Generators: `generateResourceUrl()`, `generateServiceName()`
- Security: `sanitizeShellArg()`
- Utilities: `formatDate()`, `parseConfigJson()`

**Usage:**
```typescript
import { validateEnvironmentName, generateResourceUrl } from '@spawner/utils';
```

## Workspace Dependencies

Packages use `workspace:*` protocol to depend on other workspace packages:

```json
{
  "dependencies": {
    "@spawner/types": "workspace:*",
    "@spawner/config": "workspace:*",
    "@spawner/utils": "workspace:*"
  }
}
```

pnpm automatically links these during installation.

## Turborepo Pipeline

The `turbo.json` configuration defines the task pipeline:

```json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    }
  }
}
```

**Pipeline Explanation:**
- `^build`: Wait for dependencies' build tasks first
- `outputs`: Cache these directories
- `cache: false`: Don't cache dev mode
- `persistent: true`: Keep the task running

## TypeScript Configuration

### Base Config (tsconfig.base.json)

Shared TypeScript configuration extended by all packages:

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "commonjs",
    "declaration": true,
    "strict": true,
    ...
  }
}
```

### Package Configs

Each package extends the base config:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

## Development Workflow

### Adding a New Feature

1. **Create shared types** (if needed):
   ```bash
   # Edit packages/types/src/index.ts
   pnpm --filter @spawner/types build
   ```

2. **Update backend**:
   ```bash
   cd apps/api
   # Make changes
   pnpm dev  # Test locally
   ```

3. **Update frontend**:
   ```bash
   cd apps/web
   # Make changes
   pnpm dev  # Test locally
   ```

4. **Test everything**:
   ```bash
   pnpm build  # Build all packages
   ```

### Adding Dependencies

```bash
# Add to root (build tools, linters)
pnpm add -w -D prettier

# Add to specific app
pnpm --filter @spawner/api add lodash
pnpm --filter @spawner/web add vue-awesome

# Add to shared package
pnpm --filter @spawner/types add -D @types/node
```

### Creating a New Shared Package

1. **Create directory structure**:
   ```bash
   mkdir -p packages/new-package/src
   ```

2. **Create package.json**:
   ```json
   {
     "name": "@spawner/new-package",
     "version": "1.0.0",
     "private": true,
     "main": "./dist/index.js",
     "types": "./dist/index.d.ts",
     "scripts": {
       "build": "tsc",
       "dev": "tsc --watch"
     }
   }
   ```

3. **Create tsconfig.json**:
   ```json
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": {
       "outDir": "./dist",
       "rootDir": "./src"
     }
   }
   ```

4. **Update pnpm-workspace.yaml** (if needed):
   ```yaml
   packages:
     - 'apps/*'
     - 'packages/*'  # Already includes new-package
   ```

5. **Install and build**:
   ```bash
   pnpm install
   pnpm --filter @spawner/new-package build
   ```

## Best Practices

### 1. Keep Packages Focused

Each package should have a single, clear responsibility:
- `@spawner/types`: Only types, no logic
- `@spawner/config`: Only constants and configs
- `@spawner/utils`: Pure utility functions

### 2. Avoid Circular Dependencies

```typescript
// ❌ Bad: Circular dependency
// packages/types/index.ts
import { formatDate } from '@spawner/utils';

// packages/utils/index.ts
import type { Environment } from '@spawner/types';

// ✅ Good: Utils depends on types, but not vice versa
```

### 3. Build Packages Before Apps

Turborepo handles this automatically with `dependsOn: ["^build"]`.

### 4. Use Type-Only Imports

```typescript
// ✅ Good: Type-only import
import type { Environment } from '@spawner/types';

// ❌ Avoid: Regular import for types
import { Environment } from '@spawner/types';
```

### 5. Leverage Turborepo Caching

Run `pnpm build` frequently. Second builds are instant thanks to caching!

## CI/CD Integration

### GitHub Actions Example

```yaml
name: CI

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - uses: pnpm/action-setup@v2
        with:
          version: 8

      - uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'pnpm'

      - run: pnpm install
      - run: pnpm build
      - run: pnpm lint
```

## Future Enhancements

### Potential Additions

1. **@spawner/ui-components**: Shared Vue components
2. **@spawner/api-client**: Typed API client for frontend
3. **@spawner/testing**: Shared test utilities
4. **@spawner/eslint-config**: Shared ESLint configuration
5. **@spawner/prettier-config**: Shared Prettier configuration

### Remote Caching

Turborepo supports remote caching to share build artifacts across the team:

```bash
# Login to Vercel (free tier available)
npx turbo login

# Link repo
npx turbo link

# Builds are now cached remotely!
```

## Resources

- [pnpm Workspaces](https://pnpm.io/workspaces)
- [Turborepo Documentation](https://turbo.build/repo/docs)
- [NestJS](https://nestjs.com/)
- [Vue.js 3](https://vuejs.org/)
- [2025 Monorepo Best Practices](https://medium.com/@TheblogStacker/2025-monorepo-that-actually-scales-turborepo-pnpm-for-next-js-ab4492fbde2a)
