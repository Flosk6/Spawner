# Spawner - Environment Management System

> Self-hosted preview environments with automatic Docker orchestration
>
> **License:** AGPL-3.0 | **Copyright © 2024 Florian**

Spawner is a self-hosted application for creating and managing preview environments based on Git branches. It enables teams to quickly spin up complete development environments containing multiple services with automatic Docker orchestration.

## 🚀 Installation Rapide (VPS)

```bash
curl -fsSL https://raw.githubusercontent.com/votre-org/spawner/main/install.sh | bash
```

**C'est tout!** Le script installe automatiquement:

- ✅ Docker & Docker Compose
- ✅ Node.js 20 & pnpm
- ✅ PostgreSQL
- ✅ Traefik (reverse proxy + SSL automatique)
- ✅ Spawner (API + Web)

**Durée:** 10-15 minutes | **Prérequis:** VPS Ubuntu 22.04+, domaine configuré

Après l'installation, accédez à `https://spawner.votredomaine.com` et connectez-vous avec GitHub!

### Installation Manuelle

Si vous préférez installer manuellement ou personnaliser l'installation, consultez le [Guide de Déploiement VPS](VPS-DEPLOYMENT-GUIDE.md).

## Features

- **OAuth GitHub Authentication**: Secure team-based access control via GitHub organization teams
- **Multi-Project Support**: Manage multiple projects with separate configurations and environments
- **Git-based Deployments**: Clone and deploy from Git branches using SSH deploy keys
- **Multi-service Environments**: Support for Laravel APIs, Next.js frontends, and MySQL databases
- **Automatic URL Generation**: Each environment gets unique URLs based on naming conventions
- **Docker Compose Orchestration**: Automatic generation and management of Docker Compose configurations
- **Auto-Update System**: Automatic updates from GitHub with webhook support
- **System Patch Management**: Weekly checks and manual application of OS security updates
- **Web UI**: Simple interface for creating, viewing, and managing environments
- **Container Logs**: View logs for individual services directly from the UI
- **Audit Logging**: Track all user actions for security and compliance

## Monorepo Architecture

This project uses a modern **pnpm + Turborepo** monorepo setup for optimal development experience and build performance.

```
spawner/
├── apps/
│   ├── api/              # NestJS backend
│   └── web/              # Vue.js frontend
├── packages/
│   ├── types/            # Shared TypeScript types
│   ├── config/           # Shared configuration constants
│   └── utils/            # Shared utility functions
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

### Backend (apps/api)

- NestJS (TypeScript)
- SQLite database with TypeORM
- Docker integration via CLI and socket access
- SSH key management for Git repositories

### Frontend (apps/web)

- Vue.js 3 with Composition API
- Vite build system
- Tailwind CSS styling
- Axios for API communication

### Shared Packages

- **@spawner/types**: Common TypeScript interfaces and types
- **@spawner/config**: Configuration constants and defaults
- **@spawner/utils**: Utility functions for validation, URL generation, etc.

## Prerequisites

- Ubuntu 22.04+ (or compatible Linux distribution)
- Docker and Docker Compose installed
- Node.js 20+ and **pnpm 8+** (for local development)
- Domain with wildcard DNS configured:
  - `spawner.yourdomain.com` → VPS IP
  - `*.preview.yourdomain.com` → VPS IP

### Installing pnpm

```bash
npm install -g pnpm@latest
# or
curl -fsSL https://get.pnpm.io/install.sh | sh -
```

## Installation

### 1. Clone the Repository

```bash
git clone <your-spawner-repo>
cd spawner
```

### 2. Configure Environment Variables

**Spawner uses a centralized configuration** with all environment variables in the root `.env` file.

```bash
# Copy the example file
cp .env.example .env

# Generate secrets
openssl rand -base64 32  # For SESSION_SECRET

# Edit and fill in your values
nano .env
```

**Minimum required values:**

```bash
# GitHub OAuth (create at https://github.com/settings/developers)
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
GITHUB_ORG=your_org
GITHUB_TEAM=your_team

# Session security
SESSION_SECRET=your_generated_secret
```

**Verify your configuration:**

```bash
./scripts/check-env.sh
```

See [ENV-CONFIGURATION.md](ENV-CONFIGURATION.md) for complete guide.

### 3. Configure Project

Create or edit `/opt/spawner/project.config.yml`:

```yaml
baseDomain: "preview.yourdomain.com"

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

### 4. Create Required Directories

```bash
sudo mkdir -p /opt/spawner/{data,git-keys,repos,envs}
sudo cp project.config.yml /opt/spawner/
```

### 5. Build and Start Spawner

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start in development mode
pnpm dev
```

This will start:

- `spawner-api` on port 3000
- `spawner-web` on port 8080

### 5. Configure Reverse Proxy

#### Option A: Nginx

```nginx
# Spawner UI
server {
    listen 80;
    server_name spawner.yourdomain.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# Wildcard for preview environments (if using Traefik for env routing)
server {
    listen 80;
    server_name *.preview.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

#### Option B: Traefik

Traefik is recommended for automatic routing of preview environments. Add Traefik labels to your docker-compose.yml or configure Traefik separately.

### 6. Setup OAuth Authentication

Configure GitHub OAuth for secure access control. See [OAUTH-SETUP.md](OAUTH-SETUP.md) for detailed instructions.

Quick setup:

1. Create a GitHub OAuth App in your organization settings
2. Configure environment variables in `apps/api/.env`:
   ```env
   GITHUB_CLIENT_ID=your_client_id
   GITHUB_CLIENT_SECRET=your_client_secret
   GITHUB_CALLBACK_URL=http://localhost:8080/api/auth/github/callback
   GITHUB_ORG=your_org_name
   GITHUB_TEAM=your_team_slug
   SESSION_SECRET=$(openssl rand -base64 32)
   ```
3. Add team members to your GitHub team

### 7. Setup SSH Deploy Key

1. Open Spawner UI at `http://spawner.yourdomain.com`
2. Click "Generate SSH Key"
3. Copy the public key
4. Add it as a deploy key (read-only) to each Git repository in your project config
5. Test the connection using the "Test" button

## Usage

### Creating an Environment

1. Go to Spawner dashboard
2. Click "Create Environment"
3. Enter a name (e.g., `feature-auth-123`)
4. Select branches for each repository
5. Click "Create Environment"

The system will:

- Clone/pull the specified branches
- Generate a `docker-compose.yml` file
- Start all containers
- Provide URLs for accessing services

### Viewing Environment Details

Click "View" on any environment to see:

- Resource status (running/stopped)
- Container logs
- Public URLs
- Configuration details

### Deleting an Environment

From the environment detail page or dashboard:

1. Click "Delete"
2. Confirm the action
3. All containers, volumes, and files will be removed

## Update System

Spawner inclut un système complet de gestion des mises à jour:

### Features

- **Auto-Update depuis GitHub**: Vérification automatique et application des nouvelles releases
- **Webhooks**: Déploiement automatique sur git push (configurable)
- **Gestion des Patches Système**: Surveillance hebdomadaire des mises à jour de packages OS
- **UI de Gestion**: Interface web pour contrôler les updates et patches
- **Rollback Support**: Revenir à une version précédente via Git tags

### Configuration Rapide

```bash
# Configuration minimale dans .env.production
GITHUB_REPO=your-org/spawner
AUTO_UPDATE_ENABLED=false          # Recommandé: manuel en prod
UPDATE_CHECK_CRON=0 * * * *       # Vérifier toutes les heures

# Webhook GitHub (optionnel)
WEBHOOK_SECRET=$(openssl rand -hex 32)
AUTO_DEPLOY_ENABLED=true
AUTO_DEPLOY_BRANCH=main
```

### Documentation Complète

Voir [UPDATE-SYSTEM.md](UPDATE-SYSTEM.md) pour:

- Configuration détaillée
- Utilisation des webhooks GitHub
- Gestion des patches système
- API de déploiement manuel
- Troubleshooting

## Development

### Initial Setup

```bash
# Install all dependencies across the monorepo
pnpm install

# Build all packages (required before development)
pnpm build
```

### Development Commands

```bash
# Start both API and Web in parallel
pnpm dev

# Start only the API
pnpm api:dev

# Start only the Web UI
pnpm web:dev

# Build everything
pnpm build

# Build specific apps
pnpm api:build
pnpm web:build

# Lint all code
pnpm lint

# Format all code
pnpm format

# Clean all build artifacts
pnpm clean
```

### Working with Packages

```bash
# Add a dependency to a specific app
pnpm --filter @spawner/api add <package-name>
pnpm --filter @spawner/web add <package-name>

# Add a dependency to a shared package
pnpm --filter @spawner/types add <package-name>

# Run a script in a specific app
pnpm --filter @spawner/api build
```

### Turborepo Benefits

- **Intelligent Caching**: Turborepo caches task outputs, making rebuilds extremely fast
- **Parallel Execution**: Tasks run in parallel when possible
- **Incremental Builds**: Only rebuilds what changed
- **Task Pipeline**: Automatically handles dependencies between packages

## Environment Variables

### Backend (apps/api/.env)

**OAuth Configuration:**

- `GITHUB_CLIENT_ID`: GitHub OAuth App Client ID (required)
- `GITHUB_CLIENT_SECRET`: GitHub OAuth App Client Secret (required)
- `GITHUB_CALLBACK_URL`: OAuth callback URL (required)
- `GITHUB_ORG`: GitHub organization name (required)
- `GITHUB_TEAM`: GitHub team slug for access control (required)
- `SESSION_SECRET`: Secret for session encryption (generate with `openssl rand -base64 32`)
- `SESSION_MAX_AGE`: Session duration in ms (default: 86400000 = 24h)
- `FRONTEND_URL`: Frontend URL for OAuth redirect (default: http://localhost:8080)

**Application Paths:**

- `PORT`: API server port (default: 3000)
- `DATABASE_PATH`: SQLite database path (default: /opt/spawner/data/spawner.db)
- `PROJECT_CONFIG_PATH`: Legacy single project config (default: /opt/spawner/project.config.yml)
- `GIT_KEYS_PATH`: SSH keys directory (default: /opt/spawner/git-keys)
- `REPOS_PATH`: Git repositories directory (default: /opt/spawner/repos)
- `ENVS_PATH`: Environments directory (default: /opt/spawner/envs)

### Frontend (apps/web/.env)

- `VITE_API_URL`: Backend API URL (for development, defaults to `/api` via proxy)

## Resource Types

### laravel-api

- Builds from Dockerfile in repository
- Auto-configured with database connection
- Exposed via Traefik with automatic HTTPS
- Required fields: `gitRepo`, `defaultBranch`, `dbResource`

### nextjs-front

- Builds from Dockerfile in repository
- Auto-configured with API URL
- Exposed via Traefik with automatic HTTPS
- Required fields: `gitRepo`, `defaultBranch`, `apiResource`

### mysql-db

- Uses MySQL 8 image
- Persistent volumes per environment
- Auto-configured credentials
- No git repository required

## Security Considerations

- **OAuth Authentication**: Team-based access control via GitHub organization membership
- **Session Management**: Encrypted sessions with configurable expiration
- **Audit Logging**: All user actions tracked in database
- **SSH Keys**: Private keys never exposed via API
- **Input Validation**: Environment names strictly validated (alphanumeric and hyphens only)
- **Shell Safety**: All shell commands use parameterized inputs with sanitization
- **Deploy Keys**: Should be configured as read-only on GitHub/GitLab
- **Production**: Always use HTTPS with valid SSL certificates

For OAuth setup details, see [OAUTH-SETUP.md](OAUTH-SETUP.md)

## Troubleshooting

### Environment creation fails

- Check Git SSH key configuration
- Verify repository access with "Test Connection"
- Check Docker logs: `docker logs spawner-api`

### Containers not starting

- Verify Dockerfiles exist in repositories
- Check resource dependencies (DB, API)
- View container logs in environment detail page

### URLs not accessible

- Verify reverse proxy configuration
- Check DNS wildcard configuration
- Ensure Traefik labels are correct

## License

Spawner is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

### What does this mean?

**You are free to:**
- ✅ Use Spawner for any purpose (personal, commercial)
- ✅ Modify the source code
- ✅ Distribute copies
- ✅ Contribute improvements back

**Under these conditions:**
- ⚠️ **If you run Spawner as a network service** (SaaS, hosting for others), **you MUST make your source code available** to users
- ⚠️ Any modifications must also be licensed under AGPL-3.0
- ⚠️ You must include copyright notices and license

### Why AGPL?

AGPL protects against companies taking the code, making modifications, and running it as a paid service without contributing back to the community. This ensures Spawner remains open and collaborative.

### Commercial Licensing

If you need to use Spawner without AGPL restrictions (e.g., proprietary modifications), contact us for a commercial license.

---

**Copyright © 2024 Florian**

See [LICENSE](LICENSE) for full text.
