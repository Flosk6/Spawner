# Quick Start - Spawner Monorepo

Get up and running with the new monorepo structure in 5 minutes.

## Prerequisites

```bash
# Check Node.js version (18+ required)
node --version

# Install pnpm globally
npm install -g pnpm@latest

# Verify installation
pnpm --version
```

## Initial Setup

```bash
# 1. Navigate to project
cd /path/to/spawner

# 2. Install all dependencies (this will take a minute)
pnpm install

# 3. Build all packages (required before dev)
pnpm build
```

**Expected output:**
```
✓ @spawner/types built in 2s
✓ @spawner/config built in 2s
✓ @spawner/utils built in 2s
✓ @spawner/api built in 15s
✓ @spawner/web built in 8s
```

## Development

### Start Everything

```bash
# Start API + Web in parallel
pnpm dev
```

**What happens:**
- API starts on `http://localhost:3000`
- Web starts on `http://localhost:8080`
- Both watch for file changes

### Start Individually

```bash
# Terminal 1 - Start API only
pnpm api:dev

# Terminal 2 - Start Web only
pnpm web:dev
```

## Common Tasks

### Building

```bash
# Build everything
pnpm build

# Build specific app
pnpm api:build
pnpm web:build

# Build specific package
pnpm --filter @spawner/types build
```

### Adding Dependencies

```bash
# Add to API
pnpm --filter @spawner/api add lodash
pnpm --filter @spawner/api add -D @types/lodash

# Add to Web
pnpm --filter @spawner/web add axios

# Add to shared package
pnpm --filter @spawner/types add -D @types/node

# Add to root (build tools only)
pnpm add -w -D prettier
```

### Cleaning

```bash
# Clean all build artifacts
pnpm clean

# Complete fresh install
pnpm clean
rm -rf node_modules
pnpm install
pnpm build
```

## Project Structure

```
spawner/
├── apps/
│   ├── api/                  # Backend (port 3000)
│   └── web/                  # Frontend (port 8080)
├── packages/
│   ├── types/                # Shared TypeScript types
│   ├── config/               # Shared constants
│   └── utils/                # Shared utilities
├── package.json              # Root package manager
├── pnpm-workspace.yaml       # Workspace definition
└── turbo.json                # Build pipeline
```

## Verification Checklist

Run these to verify everything works:

```bash
# ✅ 1. Dependencies installed
pnpm list --depth=0

# ✅ 2. All packages build
pnpm build

# ✅ 3. API starts
pnpm api:dev
# Should see: "Nest application successfully started"

# ✅ 4. Web starts
pnpm web:dev
# Should see: "VITE ready in X ms"

# ✅ 5. Full stack runs
pnpm dev
# Both should start
```

## Troubleshooting

### Issue: "Cannot find module '@spawner/types'"

**Solution**: Build the packages first
```bash
pnpm build
```

### Issue: "pnpm: command not found"

**Solution**: Install pnpm globally
```bash
npm install -g pnpm@latest
```

### Issue: "Port 3000 already in use"

**Solution**: Kill the process or change port
```bash
# Find and kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Or change port in apps/api/.env
PORT=3001
```

### Issue: Build is slow

**Solution**: Turborepo should cache. Try:
```bash
rm -rf .turbo
pnpm build
# Second build should be instant
```

## Daily Workflow

### Morning Routine

```bash
# Pull latest changes
git pull

# Install any new dependencies
pnpm install

# Start development
pnpm dev
```

### Working on a Feature

```bash
# 1. Create feature branch
git checkout -b feature/my-feature

# 2. Make changes in apps/api or apps/web

# 3. If adding shared code
# Edit packages/types/src/index.ts (for types)
# Edit packages/utils/src/index.ts (for utilities)
# Then rebuild
pnpm --filter @spawner/types build
pnpm --filter @spawner/utils build

# 4. Test your changes
pnpm dev

# 5. Build to verify
pnpm build

# 6. Commit
git add .
git commit -m "feat: add my feature"
```

### Before Committing

```bash
# Run lint
pnpm lint

# Run format
pnpm format

# Build everything
pnpm build

# If all pass, commit!
git commit -m "feat: my awesome feature"
```

## Key Commands Reference

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm build` | Build all packages & apps |
| `pnpm dev` | Start all apps in dev mode |
| `pnpm api:dev` | Start only API |
| `pnpm web:dev` | Start only Web |
| `pnpm lint` | Lint all code |
| `pnpm format` | Format all code |
| `pnpm clean` | Clean build artifacts |
| `pnpm --filter <pkg> <cmd>` | Run command in specific package |

## Next Steps

1. ✅ Read [README.md](README.md) for full documentation
2. ✅ Read [MONOREPO.md](MONOREPO.md) for architecture details
3. ✅ Read [MIGRATION-GUIDE.md](MIGRATION-GUIDE.md) for migration info
4. ✅ Check [STRUCTURE.md](STRUCTURE.md) for visual reference

## Getting Help

### Documentation Files
- [README.md](README.md) - Complete project documentation
- [MONOREPO.md](MONOREPO.md) - Monorepo architecture guide
- [MIGRATION-GUIDE.md](MIGRATION-GUIDE.md) - Migration instructions
- [STRUCTURE.md](STRUCTURE.md) - Structure reference
- [REFACTORING-SUMMARY.md](REFACTORING-SUMMARY.md) - What changed

### External Resources
- [pnpm Docs](https://pnpm.io/)
- [Turborepo Docs](https://turbo.build/repo/docs)
- [NestJS Docs](https://nestjs.com/)
- [Vue.js Docs](https://vuejs.org/)

## Success!

If you can run `pnpm dev` and see both the API and Web app start successfully, you're all set! 🎉

```bash
$ pnpm dev

@spawner/api:dev: [Nest] INFO Starting Nest application...
@spawner/api:dev: [Nest] INFO NestApplication successfully started
@spawner/web:dev: VITE v5.0.12 ready in 234 ms
@spawner/web:dev: ➜ Local: http://localhost:8080/
```

Happy coding! 🚀
