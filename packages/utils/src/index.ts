import { VALIDATION } from '@spawner/config';
import * as path from 'path';

export function validateEnvironmentName(name: string): boolean {
  return VALIDATION.ENVIRONMENT_NAME.test(name);
}

export function validateBranchName(branch: string): boolean {
  return VALIDATION.BRANCH_NAME.test(branch);
}

export function generateResourceUrl(
  resourceName: string,
  envName: string,
  baseDomain: string,
): string {
  return `${resourceName}.${envName}.${baseDomain}`;
}

export function generateServiceName(resourceName: string, envName: string): string {
  return `${resourceName}-${envName}`;
}

export function generateNetworkName(envName: string): string {
  return `net-${envName}`;
}

export function generateVolumeName(dbResourceName: string, envName: string): string {
  return `${dbResourceName}-${envName}-data`;
}

export function generateComposeProjectName(envName: string): string {
  return `env-${envName}`;
}

/**
 * Sanitizes a string for safe use in shell commands.
 *
 * Removes all shell metacharacters that could enable command injection attacks.
 * This is a defense-in-depth measure: for Git repos and branches, use the more
 * specific sanitizeGitRepo() and sanitizeGitBranch() validators instead.
 *
 * Blocked characters: ; & | ` $ ( ) { } [ ] < > \ " ' ! * ? # ~ newlines tabs
 *
 * @param arg - String to sanitize
 * @returns Sanitized string safe for shell execution
 * @throws Error if input is empty, too long (>500 chars), or becomes empty after sanitization
 *
 * @example
 * sanitizeShellArg("my-resource") // "my-resource"
 * sanitizeShellArg("evil; rm -rf /") // throws Error
 */
export function sanitizeShellArg(arg: string): string {
  if (!arg || typeof arg !== 'string') {
    throw new Error('Invalid shell argument: must be a non-empty string');
  }

  if (arg.length > 500) {
    throw new Error('Shell argument too long (max 500 characters)');
  }

  const sanitized = arg.replace(/[;&|`$(){}[\]<>\\"'!*?#~\n\r\t]/g, '');

  if (sanitized.length === 0) {
    throw new Error('Shell argument became empty after sanitization');
  }

  return sanitized;
}

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

/**
 * Validates a file path to prevent path traversal attacks.
 *
 * Ensures that a given file path, when resolved, stays within the allowed
 * base directory. This prevents attackers from using paths like "../../../etc/passwd"
 * to access files outside the intended directory tree.
 *
 * Why this matters: Without validation, a malicious resource name could
 * escape the repos directory and access sensitive system files.
 *
 * @param filePath - Relative file path to validate (must not start with /)
 * @param baseDir - Base directory that all paths must stay within
 * @returns Absolute resolved path (guaranteed to be within baseDir)
 * @throws Error if path contains .., ~, is absolute, or resolves outside baseDir
 *
 * @example
 * validateSafePath("resource/file.txt", "/opt/spawner/repos") // Valid
 * validateSafePath("../../../etc/passwd", "/opt/spawner/repos") // throws Error
 */
export function validateSafePath(filePath: string, baseDir: string): string {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path');
  }

  if (!baseDir || typeof baseDir !== 'string') {
    throw new Error('Invalid base directory');
  }

  if (filePath.includes('..') || filePath.includes('~')) {
    throw new Error('Path traversal detected: .. and ~ are not allowed');
  }

  if (filePath.startsWith('/')) {
    throw new Error('Absolute paths are not allowed');
  }

  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(baseDir, filePath);

  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    throw new Error('Path is outside allowed directory');
  }

  return resolvedPath;
}

/**
 * Validates a resource name for Docker and filesystem safety.
 *
 * Resource names are used in multiple contexts: Docker container names,
 * service names, directory names, and URL subdomains. This validator ensures
 * names are safe for all these uses and cannot be exploited for injection attacks.
 *
 * @param name - Resource name to validate
 * @returns The validated resource name (unchanged if valid)
 * @throws Error if name is empty, too long, or contains invalid characters
 *
 * @example
 * validateResourceName("my-api") // Valid
 * validateResourceName("frontend_v2") // Valid
 * validateResourceName("evil/../../../etc") // throws Error
 */
export function validateResourceName(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new Error('Invalid resource name');
  }

  if (name.length > 100) {
    throw new Error('Resource name too long');
  }

  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(name)) {
    throw new Error('Resource name can only contain letters, numbers, hyphens, and underscores');
  }

  return name;
}

export function formatDate(date: Date | string): string {
  if (typeof date === 'string') {
    return date;
  }
  return date.toISOString();
}

export function parseConfigJson<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/**
 * Validates Docker resource limit values.
 *
 * Ensures that resource limits are well-formed and within allowed boundaries
 * to prevent resource exhaustion attacks while allowing user customization.
 *
 * Validates format and enforces maximum limits:
 * - CPU: numeric value followed by optional unit (e.g., "2", "0.5")
 * - Memory: numeric value followed by unit (K, M, G) (e.g., "1G", "512M")
 *
 * @param limits - Resource limits object to validate
 * @param maxLimits - Maximum allowed limits (security boundary)
 * @throws Error if any limit value is malformed or exceeds maximum
 *
 * @example
 * validateResourceLimits({ cpu: "2", memory: "1G" }, MAX_LIMITS) // Valid
 * validateResourceLimits({ cpu: "100", memory: "1G" }, MAX_LIMITS) // throws Error
 */
export function validateResourceLimits(
  limits: {
    cpu?: string;
    memory?: string;
    cpuReservation?: string;
    memoryReservation?: string;
  },
  maxLimits: {
    cpu: string;
    memory: string;
    cpuReservation: string;
    memoryReservation: string;
  }
): void {
  const cpuPattern = /^(\d+(\.\d+)?)$/;
  const memoryPattern = /^(\d+)(K|M|G)$/i;

  if (limits.cpu !== undefined) {
    if (!cpuPattern.test(limits.cpu)) {
      throw new Error('Invalid CPU limit format. Use numeric value (e.g., "2", "0.5")');
    }
    if (parseFloat(limits.cpu) > parseFloat(maxLimits.cpu)) {
      throw new Error(`CPU limit exceeds maximum allowed (${maxLimits.cpu})`);
    }
  }

  if (limits.cpuReservation !== undefined) {
    if (!cpuPattern.test(limits.cpuReservation)) {
      throw new Error('Invalid CPU reservation format. Use numeric value (e.g., "0.5")');
    }
    if (parseFloat(limits.cpuReservation) > parseFloat(maxLimits.cpuReservation)) {
      throw new Error(`CPU reservation exceeds maximum allowed (${maxLimits.cpuReservation})`);
    }
  }

  const parseMemory = (mem: string): number => {
    const match = mem.match(memoryPattern);
    if (!match) return 0;

    const value = parseInt(match[1]);
    const unit = match[2].toUpperCase();

    const multipliers: Record<string, number> = { K: 1, M: 1024, G: 1024 * 1024 };
    return value * multipliers[unit];
  };

  if (limits.memory !== undefined) {
    if (!memoryPattern.test(limits.memory)) {
      throw new Error('Invalid memory limit format. Use number + unit (e.g., "1G", "512M")');
    }
    if (parseMemory(limits.memory) > parseMemory(maxLimits.memory)) {
      throw new Error(`Memory limit exceeds maximum allowed (${maxLimits.memory})`);
    }
  }

  if (limits.memoryReservation !== undefined) {
    if (!memoryPattern.test(limits.memoryReservation)) {
      throw new Error('Invalid memory reservation format. Use number + unit (e.g., "512M")');
    }
    if (parseMemory(limits.memoryReservation) > parseMemory(maxLimits.memoryReservation)) {
      throw new Error(`Memory reservation exceeds maximum allowed (${maxLimits.memoryReservation})`);
    }
  }
}
