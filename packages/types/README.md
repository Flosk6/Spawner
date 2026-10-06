# @spawner/types

The shapes the Spawner API returns, shared by the web interface and the CLI.

```typescript
import type { Environment, Job, Project } from '@spawner/types';
```

- **Projects**: `Project`, `ProjectSummary` (with its count of live environments), `ProjectInput`
- **Environments**: `Environment`, `EnvironmentStatus`, `Exposure`, `EnvironmentSource`, `ServiceState`, `UsagePoint`, `ExecResult`
- **Jobs**: `Job`, `JobType`, `JobStatus`, `JobPhase`, `JobAccepted` (the answer to every request that changes an environment)
- **Authentication and git**: `User`, `AuthStatus`, `GitKeyInfo`, `GitTestResult`, `RepoKeyInfo`
