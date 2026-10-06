/**
 * Validates and sanitizes a Git repository URL.
 *
 * Only allows well-formed SSH and HTTPS Git URLs to prevent command injection
 * and ensure compatibility with git clone operations. Rejects malformed URLs
 * that could contain shell metacharacters.
 *
 * Allowed formats:
 * - SSH: git@github.com:user/repo.git
 * - HTTPS: https://github.com/user/repo.git
 *
 * @param repo - Git repository URL to validate
 * @returns The validated repository URL (unchanged if valid)
 * @throws Error if URL is malformed, too long, or uses unsupported protocol
 *
 * @example
 * sanitizeGitRepo("git@github.com:user/repo.git") // Valid
 * sanitizeGitRepo("https://github.com/user/repo.git") // Valid
 * sanitizeGitRepo("file:///etc/passwd") // throws Error
 */
export function sanitizeGitRepo(repo: string): string {
  if (!repo || typeof repo !== 'string') {
    throw new Error('Invalid git repository: must be a non-empty string');
  }

  if (repo.length > 500) {
    throw new Error('Git repository URL too long');
  }

  const sshPattern = /^git@[\w.-]+:[\w\-./]+\.git$/;
  const httpsPattern = /^https?:\/\/[\w.-]+\/[\w\-./]+\.git$/;

  if (!sshPattern.test(repo) && !httpsPattern.test(repo)) {
    throw new Error('Invalid git repository format. Must be SSH (git@host:path.git) or HTTPS (https://host/path.git)');
  }

  return repo;
}

/**
 * Validates and sanitizes a Git branch name.
 *
 * Enforces Git's branch naming conventions to prevent command injection and
 * ensure git checkout operations work correctly. Rejects branch names with
 * special sequences that could be exploited or cause git errors.
 *
 * Rules enforced:
 * - Must start with alphanumeric character
 * - Can contain: letters, numbers, -, _, /, .
 * - Cannot contain: .., @{, \, spaces, ~
 * - Maximum 200 characters
 *
 * @param branch - Git branch name to validate
 * @returns The validated branch name (unchanged if valid)
 * @throws Error if branch name violates Git naming rules or contains dangerous patterns
 *
 * @example
 * sanitizeGitBranch("feature/auth-123") // Valid
 * sanitizeGitBranch("main") // Valid
 * sanitizeGitBranch("../../../etc/passwd") // throws Error
 */
export function sanitizeGitBranch(branch: string): string {
  if (!branch || typeof branch !== 'string') {
    throw new Error('Invalid branch name: must be a non-empty string');
  }

  if (branch.length > 200) {
    throw new Error('Branch name too long');
  }

  const validBranchPattern = /^[a-zA-Z0-9][a-zA-Z0-9._\/-]*$/;

  if (!validBranchPattern.test(branch)) {
    throw new Error('Invalid branch name format');
  }

  if (branch.includes('..') || branch.includes('@{') || branch.includes('\\')) {
    throw new Error('Branch name contains invalid patterns');
  }

  return branch;
}
