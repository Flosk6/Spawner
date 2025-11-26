# @spawner/types

Shared TypeScript types and interfaces for the Spawner monorepo.

## Usage

```typescript
import type { Environment, ResourceType, ProjectConfig } from '@spawner/types';
```

## Exports

- **ResourceType**: `'laravel-api' | 'nextjs-front' | 'mysql-db'`
- **EnvironmentStatus**: `'creating' | 'running' | 'failed' | 'deleting'`
- **ProjectConfig**: Project configuration interface
- **Environment**: Environment entity interface
- **EnvironmentResource**: Environment resource interface
- And more...
