# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Spawner is a self-hosted environment management system for creating and managing preview environments based on Git branches. It enables teams to quickly spin up complete development environments containing multiple services (Laravel APIs, Next.js frontends, MySQL databases) with automatic Docker Compose orchestration and Git repository management via SSH deploy keys.

## Monorepo Architecture

This is a **pnpm + Turborepo** monorepo with three main parts:
- **apps/api**: NestJS backend (port 3000)
- **apps/web**: Vue.js 3 frontend with Vite (port 5173 in dev)
- **packages/**: Shared TypeScript packages (`@spawner/types`, `@spawner/config`, `@spawner/utils`)

All packages use `workspace:*` dependencies to reference each other. Shared packages must be built before running apps.

## Development Commands

### Initial Setup
```bash
pnpm install              # Install all dependencies across monorepo
pnpm build                # Build all packages (required first!)
```

### Development
```bash
pnpm dev                  # Start both API and Web in parallel watch mode
pnpm api:dev              # Start only NestJS backend (watch mode)
pnpm web:dev              # Start only Vue.js frontend (Vite dev server)
```

### Building
```bash
pnpm build                # Build all packages and apps (uses Turborepo cache)
pnpm api:build            # Build only backend
pnpm web:build            # Build only frontend
pnpm --filter @spawner/types build    # Build specific shared package
```

### Code Quality
```bash
pnpm lint                 # Lint all code
pnpm format               # Format all code with Prettier
pnpm clean                # Clean all build artifacts + node_modules
```

### Adding Dependencies
```bash
# To root (build tools only)
pnpm add -w -D <package>

# To specific app
pnpm --filter @spawner/api add <package>
pnpm --filter @spawner/web add <package>

# To shared package
pnpm --filter @spawner/types add <package>
```

## Backend Architecture (apps/api)

NestJS application structured as feature modules:

### Module Structure
- **modules/project/**: Single project management (original POC - reads from project.config.yml)
- **modules/projects/**: Multi-project CRUD (new feature supporting multiple projects via database)
- **modules/git/**: SSH key generation, Git repository testing
- **modules/environment/**: Environment lifecycle (create, list, view, delete, logs)

### Key Files
- [app.module.ts](apps/api/src/app.module.ts): Root module with TypeORM configuration
- [main.ts](apps/api/src/main.ts): Bootstrap, CORS, global prefix `/api`
- **entities/**: TypeORM entities (Setting, Environment, EnvironmentResource, Project, ProjectResource)
- **common/**: Shared guards, interceptors, filters

### Database
SQLite with TypeORM. Default path: `/opt/spawner/data/spawner.db` (configurable via `DATABASE_PATH` env var).

Tables:
- `settings`: Key-value store for SSH keys, paths
- `environments`: Environment metadata (name, status, config_json, project_id)
- `environment_resources`: Per-environment resource details (branch, URL, status)
- `projects`: Multi-project support (name, baseDomain, config)
- `project_resources`: Resources per project

### Environment Variables (Backend)
- `PORT`: API server port (default: 3000)
- `DATABASE_PATH`: SQLite file path (default: /opt/spawner/data/spawner.db)
- `PROJECT_CONFIG_PATH`: Legacy single project config (default: /opt/spawner/project.config.yml)
- `GIT_KEYS_PATH`: SSH keys directory (default: /opt/spawner/git-keys)
- `REPOS_PATH`: Git clones directory (default: /opt/spawner/repos)
- `ENVS_PATH`: Environment docker-compose files (default: /opt/spawner/envs)

## Frontend Architecture (apps/web)

Vue.js 3 with Composition API, Vue Router 4, and Tailwind CSS.

### Views (apps/web/src/views)
- **Dashboard.vue**: Git SSH key management + environment list
- **EnvironmentNew.vue**: Create environment form with branch selection
- **EnvironmentDetail.vue**: Resource status, URLs, logs viewer, delete action
- **Projects.vue**: Multi-project management (list, create, edit, delete)

### Key Patterns
- **Composition API**: All components use `<script setup>` syntax
- **Services**: API calls centralized in `services/api.ts`
- **Routing**: Vue Router with route params for environment IDs
- **State**: No global state manager (uses props/composition for now)

### Environment Variables (Frontend)
- `VITE_API_URL`: Backend URL (defaults to `/api` for production proxying)

## Shared Packages

### @spawner/types (packages/types)
TypeScript type definitions shared across frontend and backend.

**Key Types:**
- `ResourceType`: Union type `'laravel-api' | 'nextjs-front' | 'mysql-db'`
- `EnvironmentStatus`: `'creating' | 'running' | 'failed' | 'stopped'`
- `ProjectConfig`: Project configuration structure
- `Environment`: Environment entity interface
- `EnvironmentResource`: Resource entity interface

**Usage:**
```typescript
import type { Environment, ResourceType } from '@spawner/types';
```

### @spawner/config (packages/config)
Constants, defaults, and validation patterns.

**Exports:**
- `ENV_VARS`: Environment variable names
- `DEFAULTS`: Default ports, passwords, Docker images
- `VALIDATION`: Regex patterns (e.g., environment name: `^[a-z0-9-]+$`)
- `RESOURCE_CONFIGS`: Resource type metadata (requiresGit, requiresDb, etc.)
- Helper functions: `isGitResource()`, `requiresDatabase()`

### @spawner/utils (packages/utils)
Utility functions for validation, URL generation, security.

**Key Functions:**
- `validateEnvironmentName(name: string): boolean`
- `generateResourceUrl(resourceName: string, envName: string, baseDomain: string): string`
- `sanitizeShellArg(arg: string): string` - Critical for security
- `generateServiceName(resourceName: string, envName: string): string`

## API Endpoints

Base: `/api`

### Project (Legacy Single Project)
- `GET /api/project`: Returns baseDomain and resources from project.config.yml

### Projects (Multi-Project)
- `GET /api/projects`: List all projects
- `POST /api/projects`: Create project with baseDomain, resources
- `GET /api/projects/:id`: Get single project
- `PUT /api/projects/:id`: Update project configuration
- `DELETE /api/projects/:id`: Delete project and all its environments

### Git Management
- `GET /api/git/key`: Check if SSH deploy key exists, return public key
- `POST /api/git/key/generate`: Generate ed25519 SSH key pair
- `POST /api/git/test`: Test Git repo access via `git ls-remote`
  - Body: `{ "resourceName": "main-api" }`

### Environments
- `GET /api/environments`: List all environments (optional `?projectId=X`)
- `POST /api/environments`: Create new environment
  - Body: `{ "name": "feature-auth-123", "branches": { "main-api": "feature/auth" }, "projectId": 1 }`
  - Name validation: `^[a-z0-9-]+$`
  - Returns 409 if name exists for that project
- `GET /api/environments/:id`: Get environment with resource status
- `DELETE /api/environments/:id`: Destroy (`docker compose down -v` + cleanup)
- `GET /api/environments/:id/logs/:resourceName`: Fetch container logs

## Environment Creation Workflow

When `POST /api/environments` is called:
1. Validate input (name regex, branches for all git resources)
2. Create `environments` record with `status="creating"`
3. Create directory `/opt/spawner/envs/<projectName>-<envName>/`
4. For each git resource:
   - Clone repo to `/opt/spawner/repos/<resourceName>/` (first time)
   - Or: `git fetch && git checkout <branch>`
5. Generate `docker-compose.yml` with:
   - Network: `net-<projectName>-<envName>`
   - Services: `<resourceName>-<envName>`
   - Volumes: `<dbResourceName>-<envName>-data`
   - Traefik labels: `<resourceName>.<envName>.<baseDomain>`
   - Auto-wired env vars (DB_HOST, NEXT_PUBLIC_API_URL, etc.)
6. Execute: `docker compose -p env-<projectName>-<envName> up -d`
7. Populate `environment_resources` table
8. Update environment status to "running" or "failed"

**Implementation:** See [environment.service.ts](apps/api/src/modules/environment/environment.service.ts) `createEnvironment()` method.

## Docker Compose Generation

Example for environment "feature-123" in project "myapp" with baseDomain "preview.example.com":

- **Service naming:** `main-api-feature-123`
- **Network:** `net-myapp-feature-123`
- **Volume:** `main-db-feature-123-data`
- **URL:** `main-api.feature-123.preview.example.com`

### Laravel API Service
```yaml
build:
  context: /opt/spawner/repos/main-api
environment:
  - DB_HOST=main-db-feature-123
  - DB_DATABASE=myapp
  - DB_USERNAME=spawner
  - DB_PASSWORD=<generated>
depends_on:
  - main-db-feature-123
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.main-api-feature-123.rule=Host(`main-api.feature-123.preview.example.com`)"
```

### Next.js Frontend Service
```yaml
build:
  context: /opt/spawner/repos/main-front
environment:
  - NEXT_PUBLIC_API_URL=https://main-api.feature-123.preview.example.com
```

### MySQL Service
```yaml
image: mysql:8
environment:
  - MYSQL_DATABASE=myapp
  - MYSQL_USER=spawner
  - MYSQL_PASSWORD=<generated>
  - MYSQL_ROOT_PASSWORD=<generated>
volumes:
  - main-db-feature-123-data:/var/lib/mysql
```

## Configuration Format

`project.config.yml` (legacy single project mode):
```yaml
baseDomain: "preview.example.com"

resources:
  - name: "main-api"
    type: "laravel-api"
    gitRepo: "git@github.com:org/main-api.git"
    defaultBranch: "develop"
    dbResource: "main-db"

  - name: "main-front"
    type: "nextjs-front"
    gitRepo: "git@github.com:org/main-front.git"
    defaultBranch: "develop"
    apiResource: "main-api"

  - name: "main-db"
    type: "mysql-db"
```

**Resource Types:**
- `laravel-api`: Requires `gitRepo`, `defaultBranch`, `dbResource`
- `nextjs-front`: Requires `gitRepo`, `defaultBranch`, `apiResource`
- `mysql-db`: No additional fields

## Security Constraints

- **SSH Keys**: Private key NEVER exposed via API (stored at `/opt/spawner/git-keys/id_spawner`)
- **Environment Names**: Strictly validated with regex `^[a-z0-9-]+$` to prevent injection
- **Shell Commands**: All user input MUST use `sanitizeShellArg()` from `@spawner/utils`
- **Deploy Keys**: Should be read-only on GitHub/GitLab
- **Production**: Use HTTPS reverse proxy, Basic Auth or IP allowlist

## Turborepo Pipeline

The `turbo.json` defines task dependencies:
- `build`: Depends on `^build` (builds dependencies first), caches `dist/**`
- `dev`: No cache, persistent (keeps running)
- `lint`: Depends on `^build` (needs types built first)

**Caching:** Second builds are instant. Run `pnpm build` frequently without worry.

## Infrastructure Notes

- **Deployment Target:** Ubuntu 22.04+ VPS
- **Docker Socket:** Backend needs access to `/var/run/docker.sock`
- **Directory Structure:** All data under `/opt/spawner/` (data, git-keys, repos, envs)
- **Reverse Proxy:** Nginx or Traefik
  - `spawner.yourdomain.com` → Spawner UI/API
  - `*.preview.yourdomain.com` → Wildcard for environments

## Out of Scope (POC)

- User authentication/authorization (Basic Auth recommended for now)
- UI for editing project configs (manual YAML or DB edits)
- Advanced env var templating
- SQL dump imports
- Webhook integration
- Auto-expiration
- Advanced monitoring/metrics

## Common Tasks

### Adding a New Resource Type
1. Add type to `ResourceType` union in `packages/types/src/index.ts`
2. Add config to `RESOURCE_CONFIGS` in `packages/config/src/index.ts`
3. Update docker-compose generation in `apps/api/src/modules/environment/environment.service.ts`
4. Update frontend form in `apps/web/src/views/EnvironmentNew.vue`
5. Rebuild: `pnpm build`

### Debugging Environment Creation
- Check [environment.service.ts](apps/api/src/modules/environment/environment.service.ts) `createEnvironment()` method
- Look at database: `sqlite3 /opt/spawner/data/spawner.db`
- Check Docker logs: `docker logs spawner-api`
- Check generated docker-compose: `cat /opt/spawner/envs/<env-name>/docker-compose.yml`

### Working with Local Development Data
- Local test data stored in `local-data/` (git-ignored)
- Script: `./setup-local.sh` creates dummy project config for testing
- Use `project.config.local.yml` for local development
