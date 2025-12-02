import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { GitKeysService } from './git-keys.service';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { sanitizeShellArg, sanitizeGitRepo, sanitizeGitBranch } from '@spawner/utils';

const execAsync = promisify(exec);

@Injectable()
export class GitService {
  private readonly gitKeysPath: string;
  private readonly privateKeyPath: string;
  private readonly publicKeyPath: string;

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => GitKeysService))
    private gitKeysService: GitKeysService,
  ) {
    this.gitKeysPath = process.env.GIT_KEYS_PATH || '/opt/spawner/git-keys';
    this.privateKeyPath = path.join(this.gitKeysPath, 'id_spawner');
    this.publicKeyPath = path.join(this.gitKeysPath, 'id_spawner.pub');
  }

  async getKeyInfo() {
    const exists = fs.existsSync(this.privateKeyPath) && fs.existsSync(this.publicKeyPath);

    if (!exists) {
      return { exists: false, publicKey: null };
    }

    const publicKey = fs.readFileSync(this.publicKeyPath, 'utf8').trim();
    return { exists: true, publicKey };
  }

  async generateKey() {
    // Ensure directory exists
    if (!fs.existsSync(this.gitKeysPath)) {
      fs.mkdirSync(this.gitKeysPath, { recursive: true });
    }

    // Check if key already exists
    if (fs.existsSync(this.privateKeyPath)) {
      throw new Error('SSH key already exists');
    }

    // Generate ed25519 key
    const command = `ssh-keygen -t ed25519 -f ${this.privateKeyPath} -N "" -C "spawner-deploy-key"`;
    await execAsync(command);

    // Store paths in settings
    await this.prisma.setting.upsert({
      where: { key: 'git_ssh_private_key_path' },
      update: { value: this.privateKeyPath },
      create: { key: 'git_ssh_private_key_path', value: this.privateKeyPath },
    });
    await this.prisma.setting.upsert({
      where: { key: 'git_ssh_public_key_path' },
      update: { value: this.publicKeyPath },
      create: { key: 'git_ssh_public_key_path', value: this.publicKeyPath },
    });
    await this.prisma.setting.upsert({
      where: { key: 'git_ssh_configured' },
      update: { value: 'true' },
      create: { key: 'git_ssh_configured', value: 'true' },
    });

    const publicKey = fs.readFileSync(this.publicKeyPath, 'utf8').trim();
    return { exists: true, publicKey };
  }

  async testConnection(gitRepo: string): Promise<{ ok: boolean; message: string }> {
    if (!fs.existsSync(this.privateKeyPath)) {
      return { ok: false, message: 'SSH key not configured' };
    }

    try {
      const sanitizedRepo = sanitizeGitRepo(gitRepo);
      const sshCommand = `ssh -i ${sanitizeShellArg(this.privateKeyPath)} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
      const command = `GIT_SSH_COMMAND="${sshCommand}" git ls-remote ${sanitizedRepo} HEAD`;

      await execAsync(command, { timeout: 10000 });
      return { ok: true, message: 'Connection successful' };
    } catch (error) {
      return { ok: false, message: error.message || 'Connection failed' };
    }
  }

  /**
   * Clones a Git repository or updates an existing clone to a specific branch.
   *
   * This handles the Git workflow for environment provisioning:
   * - First call: Clones the repository to persistent storage
   * - Subsequent calls: Fetches updates and hard resets to remote branch
   *
   * Security: All inputs (repo URL, branch, paths) are validated and sanitized
   * to prevent command injection. Uses per-repository SSH keys for authentication.
   *
   * Why hard reset: Preview environments should always reflect the exact remote state.
   * This handles force pushes and divergent branches without conflicts.
   *
   * @param gitRepo - Repository URL (SSH or HTTPS format)
   * @param resourceName - Resource identifier (used as directory name)
   * @param branch - Target branch name to checkout
   *
   * @throws Error if SSH key is missing for non-HTTPS repositories
   * @throws Error if git operations fail (network issues, invalid branch, etc.)
   */
  async cloneOrPull(gitRepo: string, resourceName: string, branch: string): Promise<void> {
    const sanitizedRepo = sanitizeGitRepo(gitRepo);
    const sanitizedBranch = sanitizeGitBranch(branch);
    const sanitizedResourceName = sanitizeShellArg(resourceName);

    const reposPath = process.env.REPOS_PATH || '/opt/spawner/repos';
    const repoPath = path.join(reposPath, sanitizedResourceName);

    if (!fs.existsSync(reposPath)) {
      fs.mkdirSync(reposPath, { recursive: true });
    }

    const isHttps = sanitizedRepo.startsWith('http://') || sanitizedRepo.startsWith('https://');

    const repoKeyPath = this.gitKeysService.getKeyPathForRepo(sanitizedRepo);
    const sanitizedKeyPath = sanitizeShellArg(repoKeyPath);
    const sshCommand = `ssh -i ${sanitizedKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;

    if (!isHttps && !fs.existsSync(repoKeyPath)) {
      throw new Error(`SSH key not found for repository ${sanitizedRepo}. Please generate a key in Git Settings.`);
    }

    if (!fs.existsSync(repoPath)) {
      console.log(`Cloning ${sanitizedResourceName} from ${sanitizedRepo}...`);
      console.log(`   This may take a few minutes for large repositories...`);

      const sanitizedRepoPath = sanitizeShellArg(repoPath);
      const cloneCmd = isHttps
        ? `git clone --progress ${sanitizedRepo} ${sanitizedRepoPath}`
        : `GIT_SSH_COMMAND="${sshCommand}" git clone --progress ${sanitizedRepo} ${sanitizedRepoPath}`;

      console.log(`[DEBUG] Clone command: ${cloneCmd}`);
      await execAsync(cloneCmd, { timeout: 600000 });
      console.log(`${sanitizedResourceName} cloned successfully`);
    } else {
      console.log(`Repository ${sanitizedResourceName} already exists, updating...`);
    }

    console.log(`Fetching updates for ${sanitizedResourceName}...`);
    const sanitizedRepoPath = sanitizeShellArg(repoPath);
    const fetchCmd = isHttps
      ? `cd ${sanitizedRepoPath} && git fetch origin`
      : `cd ${sanitizedRepoPath} && GIT_SSH_COMMAND="${sshCommand}" git fetch origin`;
    console.log(`[DEBUG] Fetch command: ${fetchCmd}`);
    await execAsync(fetchCmd, { timeout: 120000 });

    console.log(`Checking out branch ${sanitizedBranch} for ${sanitizedResourceName}...`);
    const checkoutCmd = `cd ${sanitizedRepoPath} && git checkout ${sanitizedBranch}`;
    console.log(`[DEBUG] Checkout command: ${checkoutCmd}`);
    await execAsync(checkoutCmd, { timeout: 30000 });

    console.log(`Syncing ${sanitizedResourceName} with remote ${sanitizedBranch}...`);
    const resetCmd = `cd ${sanitizedRepoPath} && git reset --hard origin/${sanitizedBranch}`;
    console.log(`[DEBUG] Reset command: ${resetCmd}`);
    await execAsync(resetCmd, { timeout: 30000 });
    console.log(`${sanitizedResourceName} ready on branch ${sanitizedBranch}`);
  }

  getRepoPath(resourceName: string): string {
    const reposPath = process.env.REPOS_PATH || '/opt/spawner/repos';
    return path.join(reposPath, resourceName);
  }

  /**
   * Forces a fresh fetch from remote and lists all branches.
   *
   * This method always performs a git fetch to get the latest branches,
   * unlike listRemoteBranches which uses cached data when available.
   *
   * @param gitRepo - Repository URL (SSH or HTTPS format)
   * @param resourceName - Resource name for local cache lookup
   * @returns Array of branch names (sorted alphabetically)
   *
   * @throws Error if git operations fail
   */
  async refreshRemoteBranches(gitRepo: string, resourceName: string): Promise<string[]> {
    const reposPath = process.env.REPOS_PATH || '/opt/spawner/repos';
    const localRepoPath = path.join(reposPath, resourceName);

    if (!fs.existsSync(localRepoPath)) {
      throw new Error(`Repository not found locally. Please create an environment first to clone the repository.`);
    }

    const sanitizedRepo = sanitizeGitRepo(gitRepo);
    const sanitizedRepoPath = sanitizeShellArg(localRepoPath);
    const isHttps = sanitizedRepo.startsWith('http://') || sanitizedRepo.startsWith('https://');

    const repoKeyPath = this.gitKeysService.getKeyPathForRepo(sanitizedRepo);
    const sanitizedKeyPath = sanitizeShellArg(repoKeyPath);
    const sshCommand = `ssh -i ${sanitizedKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;

    if (!isHttps && !fs.existsSync(repoKeyPath)) {
      throw new Error(`SSH key not configured. Please add the deploy key to your repository.`);
    }

    try {
      const fetchCmd = isHttps
        ? `cd ${sanitizedRepoPath} && git fetch origin --prune`
        : `cd ${sanitizedRepoPath} && GIT_SSH_COMMAND="${sshCommand}" git fetch origin --prune`;

      await execAsync(fetchCmd, { timeout: 30000 });

      const { stdout } = await execAsync(
        `cd ${sanitizedRepoPath} && git branch -r`,
        { timeout: 5000 }
      );

      const branches = stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          const trimmed = line.trim();
          const match = trimmed.match(/^origin\/(.+)$/);
          if (!match) return null;
          const branch = match[1];
          if (branch.startsWith('HEAD ')) return null;
          return branch;
        })
        .filter((branch): branch is string => branch !== null)
        .sort();

      return branches;
    } catch (error) {
      const message = error.message || '';
      if (message.includes('Repository not found') || message.includes('Could not read from remote')) {
        throw new Error('Repository access denied. Please verify the SSH deploy key is added to the repository with read permissions.');
      }
      throw new Error(`Failed to refresh branches: ${message}`);
    }
  }

  /**
   * Lists all remote branches for a Git repository.
   *
   * First attempts to use local clone if available (fast, no auth needed).
   * Falls back to remote query if local clone doesn't exist.
   *
   * @param gitRepo - Repository URL (SSH or HTTPS format)
   * @param resourceName - Optional resource name for local cache lookup
   * @returns Array of branch names (sorted alphabetically)
   *
   * @throws Error if SSH key is missing for non-HTTPS repositories
   * @throws Error if git operations fail (network issues, invalid repo, etc.)
   */
  async listRemoteBranches(gitRepo: string, resourceName?: string): Promise<string[]> {
    const reposPath = process.env.REPOS_PATH || '/opt/spawner/repos';

    if (resourceName) {
      const localRepoPath = path.join(reposPath, resourceName);

      if (fs.existsSync(localRepoPath)) {
        try {
          const sanitizedRepoPath = sanitizeShellArg(localRepoPath);
          const { stdout } = await execAsync(
            `cd ${sanitizedRepoPath} && git branch -r`,
            { timeout: 10000 }
          );

          const branches = stdout
            .split('\n')
            .filter(line => line.trim())
            .map(line => {
              const trimmed = line.trim();
              const match = trimmed.match(/^origin\/(.+)$/);
              if (!match) return null;
              const branch = match[1];
              if (branch.startsWith('HEAD ')) return null;
              return branch;
            })
            .filter((branch): branch is string => branch !== null)
            .sort();

          return branches;
        } catch (error) {
          console.warn(`Failed to list branches from local repo: ${error.message}`);
        }
      }
    }

    const sanitizedRepo = sanitizeGitRepo(gitRepo);
    const isHttps = sanitizedRepo.startsWith('http://') || sanitizedRepo.startsWith('https://');

    const repoKeyPath = this.gitKeysService.getKeyPathForRepo(sanitizedRepo);
    const sanitizedKeyPath = sanitizeShellArg(repoKeyPath);
    const sshCommand = `ssh -i ${sanitizedKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;

    if (!isHttps && !fs.existsSync(repoKeyPath)) {
      throw new Error(`SSH key not configured. Please add the deploy key to your repository in GitHub Settings > Deploy Keys.`);
    }

    try {
      const command = isHttps
        ? `git ls-remote --heads ${sanitizedRepo}`
        : `GIT_SSH_COMMAND="${sshCommand}" git ls-remote --heads ${sanitizedRepo}`;

      const { stdout } = await execAsync(command, { timeout: 30000 });

      const branches = stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          const match = line.match(/refs\/heads\/(.+)$/);
          return match ? match[1] : null;
        })
        .filter((branch): branch is string => branch !== null)
        .sort();

      return branches;
    } catch (error) {
      const message = error.message || '';
      if (message.includes('Repository not found') || message.includes('Could not read from remote')) {
        throw new Error('Repository access denied. Please verify the SSH deploy key is added to the repository with read permissions.');
      }
      throw new Error(`Unable to fetch branches. You can still enter the branch name manually.`);
    }
  }
}
