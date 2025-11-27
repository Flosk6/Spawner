# Spawner

> Self-hosted preview environments with automatic Docker orchestration
>
> **License:** AGPL-3.0 | **Copyright © 2024 Florian**

Create and manage preview environments for Laravel APIs, Next.js frontends, and MySQL databases based on Git branches. Automatic Docker orchestration with GitHub OAuth authentication.

## 🚀 Quick Start

**VPS Installation (Ubuntu 22.04+):**

```bash
curl -fsSL https://raw.githubusercontent.com/votre-org/spawner/main/install.sh | bash
```

**Prerequisites:**
- VPS with 10GB+ disk space
- DNS: `spawner.yourdomain.com` and `*.preview.yourdomain.com` → VPS IP
- GitHub OAuth App

**Duration:** 10-15 minutes | **Result:** Full production setup with HTTPS

**Local Development:**

```bash
git clone <your-repo>
cd spawner
pnpm install
pnpm build
pnpm dev
```

Access at `http://localhost:8080`

📚 **Full guides:** [VPS Deployment](VPS-DEPLOYMENT-GUIDE.md) | [OAuth Setup](OAUTH-SETUP.md) | [Environment Variables](ENV-CONFIGURATION.md)

## ✨ Features

- 🔐 **GitHub OAuth** - Team-based access control
- 🚀 **Multi-Project** - Manage multiple projects with separate configs
- 🌿 **Git Branches** - Deploy any branch with SSH deploy keys
- 🐳 **Docker** - Secure operations via Dockerode (no shell injection)
- 💻 **Interactive Terminal** - Browser-based access with security constraints
- 🔗 **Auto URLs** - Unique URLs per environment (`api.feature-123.preview.example.com`)
- 📊 **Logs & Audit** - Container logs and full action tracking
- ⚡ **Auto-Update** - GitHub webhooks and system patch management

## 🏗️ Tech Stack

**Monorepo:** pnpm + Turborepo

```
apps/
├── api/        # NestJS + PostgreSQL + TypeORM + Dockerode
└── web/        # Vue.js 3 + Vite + Tailwind CSS
packages/
├── types/      # Shared TypeScript types
├── config/     # Shared constants
└── utils/      # Shared utilities
```

**Key Technologies:**
- Backend: NestJS, PostgreSQL, Dockerode, node-pty, Socket.IO
- Frontend: Vue.js 3 Composition API, xterm.js
- Infrastructure: Docker, Traefik, Let's Encrypt

## 📖 Usage

1. **Login** with GitHub OAuth
2. **Create Project** - Configure base domain and resources
3. **Create Environment** - Select branches to deploy
4. **Access URLs** - Automatic routing (`api.feature-123.preview.example.com`)
5. **Open Terminal** - Browser-based shell access with security
6. **View Logs** - Real-time container logs
7. **Delete** - Clean removal of all resources

See [UPDATE-SYSTEM.md](UPDATE-SYSTEM.md) for auto-update configuration and system patch management.

## 💻 Development

**Setup:**
```bash
pnpm install
pnpm build
pnpm dev  # API on :3000, Web on :8080
```

**Commands:**
```bash
pnpm dev          # Start both API and Web
pnpm build        # Build all packages
pnpm lint         # Lint code
pnpm format       # Format with Prettier
pnpm --filter @spawner/api add <pkg>  # Add dependency
```

**Turborepo** provides intelligent caching and parallel execution for fast builds.

## ⚙️ Configuration

Configuration is in `.env` (development) or `.env.production` (production).

**Required:**
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` - OAuth App credentials
- `GITHUB_ORG`, `GITHUB_TEAM` - Access control
- `SESSION_SECRET` - Session encryption (`openssl rand -base64 32`)
- `DB_PASSWORD` - PostgreSQL password (production)
- `DOMAIN` - Your domain for production (e.g., `example.com`)
- `ACME_EMAIL` - Let's Encrypt SSL email

**Optional:**
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_NAME` - Database config
- `GIT_KEYS_PATH`, `REPOS_PATH`, `ENVS_PATH` - Storage paths
- `DB_LOGGING` - Enable SQL logs (`true`/`false`)

See [ENV-CONFIGURATION.md](ENV-CONFIGURATION.md) for complete reference.

## 🔧 Resource Types

| Type | Description | Required Fields |
|------|-------------|-----------------|
| **laravel-api** | Laravel backend with Dockerfile | `gitRepo`, `defaultBranch`, `dbResource` |
| **nextjs-front** | Next.js frontend with Dockerfile | `gitRepo`, `defaultBranch`, `apiResource` |
| **mysql-db** | MySQL 8 with persistent volumes | None (no git repo) |

All resources get automatic HTTPS, environment variables, and Traefik routing.

## 🔒 Security

- **OAuth** - GitHub organization + team authentication
- **Dockerode** - No shell commands, prevents injection attacks
- **Terminal** - Blocked dangerous commands, restricted paths, 3 terminals/user max
- **Audit** - All actions logged (including terminal commands)
- **HTTPS** - Automatic SSL via Let's Encrypt + Traefik
- **Deploy Keys** - Read-only SSH access to repositories

See [OAUTH-SETUP.md](OAUTH-SETUP.md) for OAuth configuration.

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| Environment creation fails | Check SSH keys, test connection, view API logs |
| Containers not starting | Verify Dockerfiles exist, check dependencies |
| URLs not accessible | Verify DNS wildcard, check Traefik labels |
| SQL logs in console | Set `DB_LOGGING=false` in `.env` |

**Logs:**
```bash
docker logs spawner-api        # API logs
docker logs spawner-web        # Web logs
docker-compose logs -f         # All services
```

## 📄 License

**AGPL-3.0** - Free to use, modify, and distribute. If you run Spawner as a SaaS, you must share your source code with users.

**Copyright © 2024 Florian** - See [LICENSE](LICENSE) | Commercial license available for proprietary use.
