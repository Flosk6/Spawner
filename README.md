# Spawner - Environment Management System

Spawner is a self-hosted application for creating and managing preview environments based on Git branches. It enables teams to quickly spin up complete development environments containing multiple services with automatic Docker Compose orchestration.

## Features

- **Git-based Deployments**: Clone and deploy from Git branches using SSH deploy keys
- **Multi-service Environments**: Support for Laravel APIs, Next.js frontends, and MySQL databases
- **Automatic URL Generation**: Each environment gets unique URLs based on naming conventions
- **Docker Compose Orchestration**: Automatic generation and management of Docker Compose configurations
- **Web UI**: Simple interface for creating, viewing, and managing environments
- **Container Logs**: View logs for individual services directly from the UI

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

### 2. Configure Project

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

### 3. Create Required Directories

```bash
sudo mkdir -p /opt/spawner/{data,git-keys,repos,envs}
sudo cp project.config.yml /opt/spawner/
```

### 4. Build and Start Spawner

```bash
docker-compose up -d --build
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

### 6. Setup SSH Deploy Key

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

### Backend (spawner-api)

- `PORT`: API server port (default: 3000)
- `DATABASE_PATH`: SQLite database path (default: /opt/spawner/data/spawner.db)
- `PROJECT_CONFIG_PATH`: Project config file path (default: /opt/spawner/project.config.yml)
- `GIT_KEYS_PATH`: SSH keys directory (default: /opt/spawner/git-keys)
- `REPOS_PATH`: Git repositories directory (default: /opt/spawner/repos)
- `ENVS_PATH`: Environments directory (default: /opt/spawner/envs)

### Frontend (spawner-web)

- `VITE_API_URL`: Backend API URL (for development)

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

- SSH private keys are never exposed via the API
- Environment names are strictly validated (alphanumeric and hyphens only)
- All shell commands use parameterized inputs
- Deploy keys should be read-only
- Recommend Basic Auth or IP allowlist on Spawner UI
- Use HTTPS in production

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

ISC
