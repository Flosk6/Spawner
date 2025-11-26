# Spawner Documentation Index

Welcome to the Spawner monorepo! This index will help you find the right documentation for your needs.

## 🚀 Getting Started

**New to the project?** Start here:

1. [QUICK-START-MONOREPO.md](QUICK-START-MONOREPO.md) - Get up and running in 5 minutes
2. [README.md](README.md) - Complete project overview and features
3. [STRUCTURE.md](STRUCTURE.md) - Visual guide to the codebase structure

## 🏗️ Architecture & Design

**Understanding the monorepo:**

- [MONOREPO.md](MONOREPO.md) - Deep dive into the monorepo architecture
- [REFACTORING-SUMMARY.md](REFACTORING-SUMMARY.md) - What changed and why
- [MIGRATION-GUIDE.md](MIGRATION-GUIDE.md) - How to migrate from the old structure

## 📦 Package Documentation

**Shared packages:**

- [packages/types/README.md](packages/types/README.md) - TypeScript types and interfaces
- [packages/config/README.md](packages/config/README.md) - Configuration constants
- [packages/utils/README.md](packages/utils/README.md) - Utility functions

## 🔧 Development

**For developers:**

- [QUICK-START-MONOREPO.md](QUICK-START-MONOREPO.md) - Quick start guide
- [README.md#development](README.md#development) - Development commands and workflow
- [MONOREPO.md#development-workflow](MONOREPO.md#development-workflow) - Detailed workflow

## 🚢 Deployment

**Production deployment:**

- [DEPLOY-IONOS.md](DEPLOY-IONOS.md) - IONOS VPS deployment guide
- [DEPLOY-ALMA-LINUX.md](DEPLOY-ALMA-LINUX.md) - AlmaLinux deployment guide
- [README.md#installation](README.md#installation) - General installation instructions

## 🎯 Project Planning

**Historical and planning documents:**

- [CLAUDE.md](CLAUDE.md) - Claude Code assistant instructions
- [spec.md](spec.md) - Original project specification
- [EVOLUTION.md](EVOLUTION.md) - Project evolution notes
- [CUSTOM-PROJECT-ANALYSIS.md](CUSTOM-PROJECT-ANALYSIS.md) - Custom project analysis

## 📖 By Use Case

### I want to...

#### ...get started quickly
→ [QUICK-START-MONOREPO.md](QUICK-START-MONOREPO.md)

#### ...understand the architecture
→ [MONOREPO.md](MONOREPO.md) + [STRUCTURE.md](STRUCTURE.md)

#### ...migrate from old structure
→ [MIGRATION-GUIDE.md](MIGRATION-GUIDE.md)

#### ...add a new feature
→ [MONOREPO.md#development-workflow](MONOREPO.md#development-workflow)

#### ...create a shared package
→ [MONOREPO.md#creating-a-new-shared-package](MONOREPO.md#creating-a-new-shared-package)

#### ...deploy to production
→ [DEPLOY-IONOS.md](DEPLOY-IONOS.md) or [DEPLOY-ALMA-LINUX.md](DEPLOY-ALMA-LINUX.md)

#### ...understand what changed
→ [REFACTORING-SUMMARY.md](REFACTORING-SUMMARY.md)

#### ...troubleshoot issues
→ [QUICK-START-MONOREPO.md#troubleshooting](QUICK-START-MONOREPO.md#troubleshooting)

#### ...learn pnpm commands
→ [MIGRATION-GUIDE.md#common-commands](MIGRATION-GUIDE.md#common-commands)

#### ...understand Turborepo
→ [MONOREPO.md#why-turborepo](MONOREPO.md#why-turborepo)

## 📁 File Organization

```
Documentation Files (by category):

Getting Started:
├── QUICK-START-MONOREPO.md          ⭐ Start here!
├── README.md                         Main documentation
└── STRUCTURE.md                      Visual structure guide

Architecture:
├── MONOREPO.md                       Architecture deep dive
├── REFACTORING-SUMMARY.md            What changed
└── MIGRATION-GUIDE.md                Migration instructions

Deployment:
├── DEPLOY-IONOS.md                   IONOS deployment
└── DEPLOY-ALMA-LINUX.md              AlmaLinux deployment

Reference:
├── CLAUDE.md                         Claude Code instructions
├── spec.md                           Original specification
├── EVOLUTION.md                      Evolution notes
└── CUSTOM-PROJECT-ANALYSIS.md        Custom analysis

Legacy (for reference):
├── QUICKSTART.md                     Old quickstart
├── START.md                          Old start guide
└── TEST.md                           Testing notes
```

## 🔑 Key Commands Reference

```bash
# Setup
pnpm install                          # Install all dependencies
pnpm build                            # Build all packages

# Development
pnpm dev                              # Start all apps
pnpm api:dev                          # Start API only
pnpm web:dev                          # Start web only

# Building
pnpm build                            # Build everything
pnpm api:build                        # Build API only
pnpm web:build                        # Build web only

# Package Management
pnpm --filter @spawner/api add <pkg> # Add to API
pnpm --filter @spawner/web add <pkg> # Add to web
pnpm --filter @spawner/types build   # Build types package

# Maintenance
pnpm lint                             # Lint all code
pnpm format                           # Format all code
pnpm clean                            # Clean build artifacts
```

## 🌳 Project Structure Quick Reference

```
spawner/
├── apps/
│   ├── api/              NestJS backend (port 3000)
│   └── web/              Vue.js frontend (port 8080)
├── packages/
│   ├── types/            Shared TypeScript types
│   ├── config/           Shared configuration
│   └── utils/            Shared utilities
├── pnpm-workspace.yaml   Workspace definition
├── turbo.json            Turborepo config
└── package.json          Root package manager
```

## 🔗 External Resources

- [pnpm Documentation](https://pnpm.io/)
- [Turborepo Documentation](https://turbo.build/repo/docs)
- [NestJS Documentation](https://nestjs.com/)
- [Vue.js 3 Documentation](https://vuejs.org/)
- [TypeScript Documentation](https://www.typescriptlang.org/)

## 📊 Documentation Stats

- **Total documentation files**: 15+
- **Monorepo-specific docs**: 6 files
- **Deployment guides**: 2 files
- **Package READMEs**: 3 files
- **Total pages**: ~100+ pages of documentation

## 🎯 Quick Navigation

| I need to... | Go to... |
|--------------|----------|
| Set up the project | [QUICK-START-MONOREPO.md](QUICK-START-MONOREPO.md) |
| Understand the architecture | [MONOREPO.md](MONOREPO.md) |
| See the structure | [STRUCTURE.md](STRUCTURE.md) |
| Learn what changed | [REFACTORING-SUMMARY.md](REFACTORING-SUMMARY.md) |
| Migrate code | [MIGRATION-GUIDE.md](MIGRATION-GUIDE.md) |
| Deploy to production | [DEPLOY-IONOS.md](DEPLOY-IONOS.md) |
| Add dependencies | [MIGRATION-GUIDE.md#managing-dependencies](MIGRATION-GUIDE.md#managing-dependencies) |
| Troubleshoot | [QUICK-START-MONOREPO.md#troubleshooting](QUICK-START-MONOREPO.md#troubleshooting) |

## 💡 Tips

- **First time here?** Read [QUICK-START-MONOREPO.md](QUICK-START-MONOREPO.md)
- **Confused about structure?** Check [STRUCTURE.md](STRUCTURE.md)
- **Want to understand why?** Read [REFACTORING-SUMMARY.md](REFACTORING-SUMMARY.md)
- **Need commands?** See [QUICK-START-MONOREPO.md#key-commands-reference](QUICK-START-MONOREPO.md#key-commands-reference)
- **Stuck?** Check [QUICK-START-MONOREPO.md#troubleshooting](QUICK-START-MONOREPO.md#troubleshooting)

## 📝 Contributing

When adding new features or packages:

1. Update relevant documentation
2. Add package README if creating new package
3. Update [STRUCTURE.md](STRUCTURE.md) if structure changes
4. Update this INDEX.md if adding new docs

---

**Last Updated**: 2025-11-25
**Monorepo Version**: 1.0.0
**Architecture**: pnpm + Turborepo
