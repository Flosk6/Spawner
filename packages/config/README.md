# @spawner/config

Shared configuration constants and utilities for the Spawner monorepo.

## Usage

```typescript
import { ENV_VARS, VALIDATION, DOCKER, RESOURCE_CONFIGS } from '@spawner/config';
```

## Exports

- **ENV_VARS**: Environment variable names
- **DEFAULTS**: Default configuration values
- **VALIDATION**: Validation regex patterns
- **DOCKER**: Docker configuration constants
- **RESOURCE_CONFIGS**: Resource type configurations
- Helper functions: `isGitResource()`, `requiresDatabase()`, `requiresApi()`
