# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Spawner is a self-hosted environment management system for creating and managing preview environments based on Git branches. It enables teams to quickly spin up complete development environments containing multiple services (Laravel APIs, Next.js frontends, MySQL databases) with automatic Docker orchestration and Git repository management via SSH deploy keys.

**Key Features:**
- GitHub OAuth authentication with team-based access control
- Multi-project support with isolated environments
- Interactive browser-based terminal access to containers
- Dockerode library for secure Docker operations (no shell command injection)
- Audit logging for all user actions
- Real-time build progress and container logs

## Monorepo Architecture

This is a **pnpm + Turborepo** monorepo:

- **apps/api**: NestJS backend (port 3000) with TypeORM + SQLite
- **apps/web**: Vue.js 3 frontend (port 5173 in dev) with Vite + Tailwind CSS
- **packages/types**: Shared TypeScript type definitions
- **packages/config**: Constants, defaults, validation patterns
- **packages/utils**: Utility functions (validation, URL generation, security)

All packages use `workspace:*` dependencies. **Shared packages must be built before running apps.**

## Documentation

### Project Documentation Directory

Project documentation is stored in `/.ai/docs/`:
- When you need to read project documentation, look in this directory first
- When you need to create or update documentation files (.md), place them in `/.ai/docs/`
- This keeps all AI-relevant documentation organized and separate from user-facing docs

**Note:** This is different from user-facing documentation (like README.md) which remains in the project root.

## Code Style

### Important Rules

- **NO EMOJIS**: Never use emojis in code, comments, error messages, or any output.
- **NEVER modify files in `local-data/repos/`**: These are Git repositories cloned by Spawner. If you find a bug:
  1. STOP - Do not modify the cloned repo
  2. INFORM the user about the issue and required fix
  3. LET THE USER make changes in their real repository and push to GitHub

  **Rationale**: Prevents divergence between real codebase and Spawner's local copies.

### Comment Guidelines

- Avoid inline comments inside functions (only for extremely complex logic)
- Use JSDoc for function/method/class documentation
- Document complexity and intent, not obvious code
- Refactor bad comments when modifying code

**Good example:**

```typescript
/**
 * Creates isolated Docker environment with network, volumes, and containers.
 *
 * @param envName - Environment identifier (e.g., "feature-123")
 * @param projectName - Project identifier for namespacing
 * @param resources - Array of project resources to include
 * @returns Environment creation result with container details
 */
async createEnvironment(envName: string, projectName: string, resources: ProjectResource[]) {
  // Implementation without inline comments
}
```

## Development Commands

### Initial Setup

```bash
pnpm install              # Install all dependencies
pnpm build                # Build all packages (required!)
```

### Development

```bash
pnpm dev                  # Start API + Web in parallel
pnpm api:dev              # Start only backend (watch mode)
pnpm web:dev              # Start only frontend (Vite dev server)
```

### Building & Quality

```bash
pnpm build                # Build all (uses Turborepo cache)
pnpm api:build            # Build backend only
pnpm web:build            # Build frontend only
pnpm lint                 # Lint all code
pnpm format               # Format with Prettier
pnpm clean                # Clean build artifacts + node_modules
```

### Adding Dependencies

```bash
pnpm add -w -D <package>                    # Root (build tools only)
pnpm --filter @spawner/api add <package>    # Backend
pnpm --filter @spawner/web add <package>    # Frontend
pnpm --filter @spawner/types add <package>  # Shared package
```

## Backend Architecture (apps/api)

NestJS application with feature modules:

### Module Structure

- **auth**: GitHub OAuth, session management, audit logging, WebSocket tokens
- **projects**: Multi-project CRUD (database-backed)
- **project**: Legacy single project (reads from project.config.yml)
- **git**: SSH key generation and repository testing
- **environment**: Environment lifecycle (create, list, view, delete, logs)
- **terminal**: WebSocket gateway for interactive container terminals

### Key Files

- **app.module.ts**: Root module with TypeORM, session setup
- **main.ts**: Bootstrap, CORS, session middleware, Passport
- **entities/**: User, AuditLog, Setting, Environment, EnvironmentResource, Project, ProjectResource
- **common/docker.service.ts**: Dockerode integration for all Docker operations
- **common/docker-compose.generator.ts**: Container configuration generation
- **modules/terminal/terminal.gateway.ts**: WebSocket terminal with security constraints

### Database (SQLite + TypeORM)

Path: `/opt/spawner/data/spawner.db` (configurable via `DATABASE_PATH`)

**Tables:**
- `users`: GitHub OAuth accounts (githubId, username, email, role, lastLoginAt)
- `audit_logs`: Action tracking (action, details, ipAddress, userAgent, timestamp)
- `sessions`: Express session storage (managed by connect-sqlite3)
- `environments`: Environment metadata (name, status, config_json, project_id)
- `environment_resources`: Resource details per environment (branch, URL, status)
- `projects`: Multi-project support (name, baseDomain, config)
- `project_resources`: Resources per project
- `settings`: Key-value store for SSH keys and paths

### Environment Variables

**OAuth & Session:**
- `GITHUB_CLIENT_ID`: GitHub OAuth Client ID (required)
- `GITHUB_CLIENT_SECRET`: GitHub OAuth Client Secret (required)
- `GITHUB_CALLBACK_URL`: OAuth callback (e.g., http://localhost:3000/api/auth/github/callback)
- `GITHUB_ORG`: Organization name for access control (required)
- `GITHUB_TEAM`: Team slug for access control (required)
- `SESSION_SECRET`: Session encryption secret (`openssl rand -base64 32`)
- `SESSION_MAX_AGE`: Session duration in ms (default: 86400000 = 24h)
- `FRONTEND_URL`: Frontend URL for redirects (default: http://localhost:8080)

**Application:**
- `PORT`: API server port (default: 3000)
- `DATABASE_PATH`: SQLite path (default: /opt/spawner/data/spawner.db)
- `GIT_KEYS_PATH`: SSH keys directory (default: /opt/spawner/git-keys)
- `REPOS_PATH`: Git clones (default: /opt/spawner/repos)
- `ENVS_PATH`: Environment files (default: /opt/spawner/envs)
- `DOCKER_SOCKET`: Docker socket (default: /var/run/docker.sock)

## Frontend Architecture (apps/web)

Vue.js 3 with Composition API, Vue Router 4, Tailwind CSS.

### Key Views

- **Login.vue**: GitHub OAuth login
- **ProjectList.vue**: Multi-project dashboard
- **ProjectForm.vue**: Create/edit project configuration
- **EnvironmentList.vue**: Environments for a project
- **EnvironmentNew.vue**: Create environment with branch selection
- **EnvironmentDetail.vue**: Resource status, URLs, terminal, logs, delete
- **GitSettings.vue**: SSH key generation and testing
- **Dashboard.vue**: Legacy single-project view

### Architecture Patterns

- **Composition API**: All components use `<script setup>`
- **State**: Pinia store for authentication (`stores/auth.ts`)
- **API**: Centralized in `services/api.ts`
- **Routing**: Navigation guards for authentication
- **WebSocket**: Socket.IO client in `components/XtermTerminal.vue`

### Environment Variables

- `VITE_API_URL`: Backend URL (defaults to `/api` for proxying)

## Authentication & Security

### GitHub OAuth Flow

1. User clicks "Login with GitHub" → `/api/auth/github`
2. GitHub authorization → callback to `/api/auth/github/callback`
3. Backend validates organization and team membership
4. Session created in SQLite, user redirected to frontend
5. All API requests authenticated via session cookie (`connect.sid`)

**Endpoints:**
- `GET /api/auth/github` - Initiate OAuth
- `GET /api/auth/github/callback` - OAuth callback
- `GET /api/auth/logout` - Destroy session
- `GET /api/auth/me` - Current user
- `GET /api/auth/status` - Auth status
- `GET /api/auth/ws-token` - Temporary WebSocket token (60s expiration)

### Security Features

**Authentication & Sessions:**
- GitHub OAuth with org/team validation
- Encrypted sessions, HttpOnly cookies
- Configurable session expiration (default 24h)
- Audit logging (LOGIN, LOGOUT, CREATE_ENV, DELETE_ENV, terminal commands)

**Terminal Security:**
- Non-root execution (www-data for Laravel, node for Next.js)
- Blocked commands: `rm -rf /`, `mkfs`, `dd`, fork bombs, `wget`, `curl`, `nc`
- Restricted directories: `/root`, `/etc`, `/sys`, `/proc`, `/boot`, `/dev`, `/bin`, `/sbin`
- Max 3 concurrent terminals per user
- Max command length: 1000 characters
- 30 second timeout per command
- All commands logged with userId

**Docker Security:**
- Dockerode library (not shell commands) prevents injection
- All user input sanitized via `sanitizeShellArg()`
- Resource limits enforced (CPU, memory)
- Isolated networks per environment

**WebSocket Authentication:**
- Temporary JWT tokens (60s expiration)
- Token validation before connection
- User identification for audit trail

## API Endpoints

Base: `/api`

### Projects

- `GET /api/projects` - List all projects
- `POST /api/projects` - Create project
- `GET /api/projects/:id` - Get project
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project and environments

### Git Management

- `GET /api/git/key` - Get public SSH key
- `POST /api/git/key/generate` - Generate ed25519 SSH key pair
- `POST /api/git/test` - Test repository access (body: `{ "resourceName": "main-api" }`)

### Environments

- `GET /api/environments` - List environments (optional `?projectId=X`)
- `POST /api/environments` - Create environment
  - Body: `{ "name": "feature-123", "branches": { "main-api": "feature/auth" }, "projectId": 1 }`
  - Name validation: `^[a-z0-9-]+$`
- `GET /api/environments/:id` - Get environment details
- `DELETE /api/environments/:id` - Destroy environment
- `GET /api/environments/:id/logs/:resourceName` - Container logs

### Terminal (WebSocket)

**Namespace:** `/terminal`
**Auth:** WS token in query params

**Events:**
- Client → `start-terminal`: `{ environmentId, resourceName }`
- Client → `terminal-input`: `{ input, resourceName }`
- Client → `stop-terminal`: `{ resourceName }`
- Server → `terminal-output`: Terminal output data
- Server → `terminal-error`: Error message
- Server → `terminal-exit`: Exit code

## Environment Creation Workflow

When `POST /api/environments` is called:

1. **Validate** input (name regex, branches for git resources)
2. **Database** - Create `environments` record with `status="creating"`
3. **Directory** - Create `/opt/spawner/envs/<projectName>-<envName>/`
4. **Git** - Clone or fetch/checkout branches to `/opt/spawner/repos/`
5. **Network** - Create Docker network via dockerode: `net-<projectName>-<envName>`
6. **Volumes** - Create volumes for databases
7. **Containers** - For each resource:
   - Build image via dockerode (if Dockerfile exists)
   - Create container with env vars, networks, volumes, resource limits
   - Start container
   - Wait for dependencies (databases first)
8. **Database** - Populate `environment_resources` table
9. **Status** - Update environment to "running" or "failed"
10. **Audit** - Log CREATE_ENV action with user details

**Files:** [environment.service.ts](apps/api/src/modules/environment/environment.service.ts), [docker.service.ts](apps/api/src/common/docker.service.ts)

## Docker Container Configuration

**Naming Convention:**
- Container: `env-<project>-<env>-<resource>-1` (e.g., `env-myapp-feature-123-main-api-1`)
- Network: `net-<project>-<env>` (e.g., `net-myapp-feature-123`)
- Volume: `<resource>-<env>-data` (e.g., `main-db-feature-123-data`)
- URL: `<resource>.<env>.<baseDomain>` (e.g., `main-api.feature-123.preview.example.com`)

**Example Laravel API Container:**

```javascript
{
  name: 'main-api-feature-123',
  buildContext: '/opt/spawner/repos/main-api',
  environment: {
    DB_HOST: 'main-db-feature-123',
    DB_DATABASE: 'myapp',
    DB_USERNAME: 'spawner',
    DB_PASSWORD: '<generated>'
  },
  networks: ['net-myapp-feature-123'],
  labels: {
    'traefik.enable': 'true',
    'traefik.http.routers.main-api-feature-123.rule': 'Host(`main-api.feature-123.preview.example.com`)'
  },
  resourceLimits: {
    cpus: '2',           // Max: 8
    memory: '1G',        // Max: 16G
    cpuReservation: '0.25',     // Max: 4
    memoryReservation: '256M'   // Max: 8G
  }
}
```

## Project Configuration

### YAML Format (legacy single project mode)

```yaml
baseDomain: "preview.example.com"

resources:
  - name: "main-api"
    type: "laravel-api"
    gitRepo: "git@github.com:org/main-api.git"
    defaultBranch: "develop"
    dbResource: "main-db"
    resourceLimits:              # Optional
      cpu: "4"
      memory: "2G"
      cpuReservation: "1"
      memoryReservation: "1G"

  - name: "main-front"
    type: "nextjs-front"
    gitRepo: "git@github.com:org/main-front.git"
    defaultBranch: "develop"
    apiResource: "main-api"

  - name: "main-db"
    type: "mysql-db"
```

### Resource Types

- **laravel-api**: Requires `gitRepo`, `defaultBranch`, `dbResource`
- **nextjs-front**: Requires `gitRepo`, `defaultBranch`, `apiResource`
- **mysql-db**: No git repository required

### Resource Limits

Defaults defined in `packages/config/src/index.ts`. Override per-resource with:
- `cpu`: CPU cores (e.g., "2", "0.5"). Max: 8
- `memory`: RAM (e.g., "1G", "512M"). Max: 16G
- `cpuReservation`: Guaranteed min CPUs. Max: 4
- `memoryReservation`: Guaranteed min RAM. Max: 8G

## Docker Management via Dockerode

All Docker operations use the [dockerode](https://github.com/apocas/dockerode) library instead of shell commands.

**Benefits:**
- Eliminates command injection vulnerabilities
- Structured error responses from Docker API
- Real-time progress streams for builds
- Programmatic control of Docker daemon

**Operations:**
- Network/volume creation and deletion
- Image building with progress streams
- Container lifecycle (create, start, stop, remove)
- Command execution inside containers
- Log retrieval and container inspection

**Implementation:** [docker.service.ts](apps/api/src/common/docker.service.ts)

## Interactive Terminal Feature

Browser-based terminal access to running containers.

**Stack:**
- Backend: `node-pty` for PTY allocation
- Frontend: `xterm.js` for terminal emulation
- Transport: Socket.IO WebSocket
- Auth: Temporary JWT tokens

**Flow:**
1. User clicks "Open Terminal" on environment detail
2. Frontend fetches WS token: `GET /api/auth/ws-token`
3. Connect to `/terminal` namespace with token
4. Backend spawns: `docker exec -it -u <user> <container> /bin/sh`
5. Bidirectional streaming via WebSocket
6. Commands logged with userId for audit
7. Security constraints enforced

**Files:** [terminal.gateway.ts](apps/api/src/modules/terminal/terminal.gateway.ts), [XtermTerminal.vue](apps/web/src/components/XtermTerminal.vue)

## Common Tasks

### Adding a New Resource Type

1. Add to `ResourceType` union: `packages/types/src/index.ts`
2. Add config: `packages/config/src/index.ts` → `RESOURCE_CONFIGS`
3. Update container creation: `apps/api/src/modules/environment/environment.service.ts`
4. Update frontend form: `apps/web/src/views/EnvironmentNew.vue`
5. Rebuild: `pnpm build`

### Setting Up GitHub OAuth (Development)

1. **Create OAuth App** on GitHub:
   - Organization → Settings → Developer settings → OAuth Apps
   - Homepage: `http://localhost:8080`
   - Callback: `http://localhost:3000/api/auth/github/callback`
   - Save Client ID and Secret

2. **Configure** `apps/api/.env`:
   ```env
   GITHUB_CLIENT_ID=your_client_id
   GITHUB_CLIENT_SECRET=your_client_secret
   GITHUB_CALLBACK_URL=http://localhost:3000/api/auth/github/callback
   GITHUB_ORG=your_org_name
   GITHUB_TEAM=your_team_slug
   SESSION_SECRET=$(openssl rand -base64 32)
   FRONTEND_URL=http://localhost:8080
   ```

3. **Create team** in GitHub organization, add members

4. **Test** at `http://localhost:8080`

### Debugging Environment Creation

```bash
# Check database
sqlite3 /opt/spawner/data/spawner.db
SELECT * FROM environments WHERE name = '<env-name>';
SELECT * FROM environment_resources WHERE environmentId = <id>;

# Check Docker
docker ps -a --filter "label=com.docker.compose.project=env-<env-name>"
docker logs <container-name>
docker network inspect net-<project>-<env>

# Check API logs
docker logs spawner-api
```

**Code inspection:**
- [environment.service.ts](apps/api/src/modules/environment/environment.service.ts) - `createEnvironment()`
- [docker.service.ts](apps/api/src/common/docker.service.ts) - Docker operations

### Debugging Authentication

```bash
# Check session
sqlite3 /opt/spawner/data/spawner.db
SELECT * FROM sessions;
SELECT * FROM audit_logs ORDER BY createdAt DESC LIMIT 10;

# Test API
curl http://localhost:3000/api/auth/status -H "Cookie: connect.sid=<cookie>"

# Check browser
# Verify connect.sid cookie exists
# Check browser console for errors
```

- Verify user in correct GitHub org/team
- Check API logs for OAuth errors
- Ensure `SESSION_SECRET` is set

## Infrastructure

### Deployment Requirements

- Ubuntu 22.04+ VPS
- Docker and Docker Compose installed
- Node.js 20+ with pnpm 8+
- Access to `/var/run/docker.sock`
- Wildcard DNS:
  - `spawner.yourdomain.com` → VPS IP
  - `*.preview.yourdomain.com` → VPS IP

### Directory Structure

All data under `/opt/spawner/`:
- `data/` - SQLite database and sessions
- `git-keys/` - SSH deploy keys
- `repos/` - Git repository clones
- `envs/` - Environment configuration files

### Reverse Proxy

Use Nginx or Traefik:
- Main app: `spawner.yourdomain.com` → Spawner UI/API
- Environments: `*.preview.yourdomain.com` → Dynamic routing

### Turborepo Caching

- `build`: Depends on `^build`, caches `dist/**`
- `dev`: No cache, persistent
- `lint`: Depends on `^build`

Second builds are instant due to caching.

## Future Enhancements

Out of scope for v1:
- Advanced env var templating (secrets management)
- SQL dump imports for database initialization
- Webhook integration (GitHub PR comments, Slack)
- Auto-expiration of old environments
- Advanced monitoring (Prometheus, Grafana)
- Multi-node Docker Swarm support
- Custom Docker registry support
