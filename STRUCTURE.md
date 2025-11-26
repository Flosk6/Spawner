# Spawner Monorepo Structure

This document provides a quick visual reference of the monorepo structure.

## Directory Tree

```
spawner/
│
├── 📁 apps/                          # Application packages
│   ├── 📁 api/                       # NestJS Backend (@spawner/api)
│   │   ├── src/
│   │   │   ├── modules/              # Feature modules (environment, git, project)
│   │   │   ├── entities/             # TypeORM entities
│   │   │   ├── common/               # Docker, env vars generators
│   │   │   ├── config/               # App configuration
│   │   │   └── main.ts               # Entry point
│   │   ├── package.json              # Private: true
│   │   ├── tsconfig.json
│   │   ├── nest-cli.json
│   │   └── .env
│   │
│   └── 📁 web/                       # Vue.js Frontend (@spawner/web)
│       ├── src/
│       │   ├── components/           # Vue components
│       │   ├── views/                # Page views
│       │   ├── router/               # Vue Router
│       │   ├── services/             # API client
│       │   ├── types/                # Re-export shared types
│       │   └── main.ts               # Entry point
│       ├── package.json              # Private: true
│       ├── vite.config.ts
│       ├── tsconfig.json
│       └── tailwind.config.js
│
├── 📦 packages/                      # Shared packages
│   ├── 📦 types/                     # @spawner/types
│   │   ├── src/
│   │   │   └── index.ts              # TypeScript interfaces & types
│   │   ├── package.json              # Private: true
│   │   ├── tsconfig.json
│   │   └── README.md
│   │
│   ├── 📦 config/                    # @spawner/config
│   │   ├── src/
│   │   │   └── index.ts              # Constants & configuration
│   │   ├── package.json              # Private: true
│   │   ├── tsconfig.json
│   │   └── README.md
│   │
│   └── 📦 utils/                     # @spawner/utils
│       ├── src/
│       │   └── index.ts              # Utility functions
│       ├── package.json              # Private: true
│       ├── tsconfig.json
│       └── README.md
│
├── 📁 .vscode/                       # VSCode configuration
│   ├── extensions.json               # Recommended extensions
│   └── settings.json                 # Editor settings
│
├── 📄 pnpm-workspace.yaml            # Workspace definition
├── 📄 turbo.json                     # Turborepo pipeline config
├── 📄 tsconfig.base.json             # Base TypeScript config
├── 📄 package.json                   # Root package.json
├── 📄 .npmrc                         # pnpm configuration
├── 📄 .gitignore                     # Git ignore
│
├── 📘 README.md                      # Main documentation
├── 📘 MONOREPO.md                    # Monorepo architecture guide
├── 📘 MIGRATION-GUIDE.md             # Migration instructions
├── 📘 STRUCTURE.md                   # This file
├── 📘 CLAUDE.md                      # Claude Code instructions
│
├── 🐳 docker-compose.yml             # Docker Compose for Spawner itself
├── 📁 local-data/                    # Local development data
│   ├── data/                         # SQLite database
│   ├── git-keys/                     # SSH keys
│   ├── repos/                        # Cloned repositories
│   └── envs/                         # Generated environments
│
└── 📝 project.config*.yml            # Project configurations
```

## Package Dependencies

```
┌─────────────────────────────────────────┐
│         @spawner/types                  │
│  (TypeScript interfaces & types)        │
└──────────────┬──────────────────────────┘
               │
               │ depends on
               ▼
┌─────────────────────────────────────────┐
│         @spawner/config                 │
│  (Constants & configuration)            │
└──────────────┬──────────────────────────┘
               │
               │ depends on
               ▼
┌─────────────────────────────────────────┐
│         @spawner/utils                  │
│  (Utility functions)                    │
└──────────────┬──────────────────────────┘
               │
               │ used by
               ▼
┌──────────────────────────┬──────────────────────────┐
│                          │                          │
│   @spawner/api           │   @spawner/web           │
│   (NestJS Backend)       │   (Vue.js Frontend)      │
│                          │                          │
└──────────────────────────┴──────────────────────────┘
```

## File Count by Type

```
TypeScript Files:
├── apps/api/src/           ~30 files
├── apps/web/src/           ~15 files
├── packages/types/src/      1 file
├── packages/config/src/     1 file
└── packages/utils/src/      1 file

Configuration Files:
├── Root configs             7 files (turbo, pnpm, tsconfig, etc.)
├── App configs              6 files (2 per app + packages)
└── Documentation            5 files (README, MONOREPO, etc.)
```

## Key Files

### Root Level

| File | Purpose |
|------|---------|
| `pnpm-workspace.yaml` | Defines workspace packages |
| `turbo.json` | Turborepo build pipeline |
| `tsconfig.base.json` | Base TypeScript configuration |
| `package.json` | Root dependencies & scripts |
| `.npmrc` | pnpm configuration |
| `.gitignore` | Git ignore rules |

### Apps

| App | Key Files |
|-----|-----------|
| `apps/api` | `main.ts`, `app.module.ts`, `nest-cli.json` |
| `apps/web` | `main.ts`, `App.vue`, `vite.config.ts` |

### Packages

| Package | Exports |
|---------|---------|
| `@spawner/types` | Types, interfaces |
| `@spawner/config` | Constants, validation regex |
| `@spawner/utils` | Utility functions |

## Build Output

```
spawner/
├── apps/
│   ├── api/
│   │   └── dist/              # Compiled NestJS app
│   │       ├── main.js
│   │       ├── *.js
│   │       └── *.d.ts
│   │
│   └── web/
│       └── dist/              # Built Vue app
│           ├── index.html
│           ├── assets/
│           └── *.js
│
└── packages/
    ├── types/
    │   └── dist/              # Compiled types
    │       ├── index.js
    │       └── index.d.ts
    │
    ├── config/
    │   └── dist/              # Compiled config
    │       ├── index.js
    │       └── index.d.ts
    │
    └── utils/
        └── dist/              # Compiled utils
            ├── index.js
            └── index.d.ts
```

## Import Patterns

### Backend (apps/api)

```typescript
// From shared packages
import type { Environment, ResourceType } from '@spawner/types';
import { VALIDATION, ENV_VARS } from '@spawner/config';
import { validateEnvironmentName, generateResourceUrl } from '@spawner/utils';

// From local modules
import { ConfigService } from './config/config.service';
import { Environment } from './entities/environment.entity';
```

### Frontend (apps/web)

```typescript
// From shared packages (via re-export in src/types/index.ts)
import type { Environment, ResourceType } from '@/types';

// Or directly
import type { Environment } from '@spawner/types';
import { VALIDATION } from '@spawner/config';
import { generateResourceUrl } from '@spawner/utils';

// From local modules
import { apiClient } from '@/services/api';
import GitKeyCard from '@/components/GitKeyCard.vue';
```

### Shared Packages

```typescript
// @spawner/config imports from @spawner/types
import type { ResourceType } from '@spawner/types';

// @spawner/utils imports from both
import type { ResourceType } from '@spawner/types';
import { VALIDATION } from '@spawner/config';
```

## Scripts Quick Reference

### Root Scripts

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages & apps
pnpm dev              # Start all apps in dev mode
pnpm lint             # Lint all code
pnpm format           # Format all code
pnpm clean            # Clean all build artifacts
```

### Filtered Scripts

```bash
# Run in specific app
pnpm --filter @spawner/api <command>
pnpm --filter @spawner/web <command>

# Run in specific package
pnpm --filter @spawner/types build
pnpm --filter @spawner/config build
pnpm --filter @spawner/utils build
```

### Common Development Workflows

```bash
# Start full stack development
pnpm dev

# Start only backend
pnpm api:dev

# Start only frontend
pnpm web:dev

# Build everything
pnpm build

# Build only backend
pnpm api:build

# Build only frontend
pnpm web:build

# Add dependency to backend
pnpm --filter @spawner/api add <package>

# Add dependency to frontend
pnpm --filter @spawner/web add <package>

# Clean and reinstall
pnpm clean
rm -rf node_modules
pnpm install
```

## Next Steps

1. **Read [MIGRATION-GUIDE.md](MIGRATION-GUIDE.md)** for setup instructions
2. **Read [MONOREPO.md](MONOREPO.md)** for architecture details
3. **Run `pnpm install`** to get started
4. **Run `pnpm build`** to build all packages
5. **Run `pnpm dev`** to start development

## Resources

- [Main README](README.md) - Complete documentation
- [Monorepo Guide](MONOREPO.md) - Architecture deep dive
- [Migration Guide](MIGRATION-GUIDE.md) - Setup instructions
- [pnpm Workspaces](https://pnpm.io/workspaces)
- [Turborepo](https://turbo.build/repo/docs)
