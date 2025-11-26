# @spawner/utils

Shared utility functions for the Spawner monorepo.

## Usage

```typescript
import { validateEnvironmentName, generateResourceUrl, sanitizeShellArg } from '@spawner/utils';
```

## Exports

### Validation
- `validateEnvironmentName(name: string): boolean`
- `validateBranchName(branch: string): boolean`

### URL & Naming
- `generateResourceUrl(resourceName, envName, baseDomain): string`
- `generateServiceName(resourceName, envName): string`
- `generateNetworkName(envName): string`
- `generateVolumeName(dbResourceName, envName): string`
- `generateComposeProjectName(envName): string`

### Security & Utilities
- `sanitizeShellArg(arg: string): string`
- `formatDate(date: Date | string): string`
- `parseConfigJson<T>(json: string): T | null`
