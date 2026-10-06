# @spawner/utils

Validators for the git inputs Spawner receives, used by the API before any git command.

```typescript
import { sanitizeGitBranch, sanitizeGitRepo } from '@spawner/utils';

sanitizeGitRepo('git@github.com:acme/app.git'); // returned unchanged
sanitizeGitBranch('feat/login');                // returned unchanged
sanitizeGitBranch('--upload-pack=x');           // throws
```

- `sanitizeGitRepo(repo)`: SSH (`git@host:path.git`) or HTTPS (`https://host/path.git`) URLs only.
- `sanitizeGitBranch(ref)`: a branch, tag or commit that cannot be read as an option or a revision expression.
