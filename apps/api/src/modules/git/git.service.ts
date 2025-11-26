import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../../entities/setting.entity';
import { GitKeysService } from './git-keys.service';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

@Injectable()
export class GitService {
  private readonly gitKeysPath: string;
  private readonly privateKeyPath: string;
  private readonly publicKeyPath: string;

  constructor(
    @InjectRepository(Setting)
    private settingRepository: Repository<Setting>,
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
    await this.settingRepository.save({ key: 'git_ssh_private_key_path', value: this.privateKeyPath });
    await this.settingRepository.save({ key: 'git_ssh_public_key_path', value: this.publicKeyPath });
    await this.settingRepository.save({ key: 'git_ssh_configured', value: 'true' });

    const publicKey = fs.readFileSync(this.publicKeyPath, 'utf8').trim();
    return { exists: true, publicKey };
  }

  async testConnection(gitRepo: string): Promise<{ ok: boolean; message: string }> {
    if (!fs.existsSync(this.privateKeyPath)) {
      return { ok: false, message: 'SSH key not configured' };
    }

    try {
      const sshCommand = `ssh -i ${this.privateKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
      const command = `GIT_SSH_COMMAND="${sshCommand}" git ls-remote ${gitRepo} HEAD`;

      await execAsync(command, { timeout: 10000 });
      return { ok: true, message: 'Connection successful' };
    } catch (error) {
      return { ok: false, message: error.message || 'Connection failed' };
    }
  }

  async cloneOrPull(gitRepo: string, resourceName: string, branch: string): Promise<void> {
    const reposPath = process.env.REPOS_PATH || '/opt/spawner/repos';
    const repoPath = path.join(reposPath, resourceName);

    // Ensure repos directory exists
    if (!fs.existsSync(reposPath)) {
      fs.mkdirSync(reposPath, { recursive: true });
    }

    // Check if it's HTTPS or SSH
    const isHttps = gitRepo.startsWith('http://') || gitRepo.startsWith('https://');

    // Use per-repository SSH key
    const repoKeyPath = this.gitKeysService.getKeyPathForRepo(gitRepo);
    const sshCommand = `ssh -i ${repoKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;

    // Verify SSH key exists for this repo
    if (!isHttps && !fs.existsSync(repoKeyPath)) {
      throw new Error(`SSH key not found for repository ${gitRepo}. Please generate a key in Git Settings.`);
    }

    if (!fs.existsSync(repoPath)) {
      // Clone - with progress logging
      console.log(`⏳ Cloning ${resourceName} from ${gitRepo}...`);
      console.log(`   This may take a few minutes for large repositories...`);

      const cloneCmd = isHttps
        ? `git clone --progress ${gitRepo} ${repoPath}`
        : `GIT_SSH_COMMAND="${sshCommand}" git clone --progress ${gitRepo} ${repoPath}`;

      // Increase timeout to 10 minutes for large repos
      await execAsync(cloneCmd, { timeout: 600000 });
      console.log(`✅ ${resourceName} cloned successfully`);
    } else {
      console.log(`📦 Repository ${resourceName} already exists, updating...`);
    }

    // Fetch and checkout
    console.log(`🔄 Fetching updates for ${resourceName}...`);
    const fetchCmd = isHttps
      ? `cd ${repoPath} && git fetch origin`
      : `cd ${repoPath} && GIT_SSH_COMMAND="${sshCommand}" git fetch origin`;
    await execAsync(fetchCmd, { timeout: 120000 });

    console.log(`🔀 Checking out branch ${branch} for ${resourceName}...`);
    // Reset any local changes before pulling
    const resetCmd = `cd ${repoPath} && git reset --hard HEAD`;
    await execAsync(resetCmd, { timeout: 30000 });

    const pullCmd = isHttps
      ? `cd ${repoPath} && git checkout ${branch} && git pull origin ${branch}`
      : `cd ${repoPath} && git checkout ${branch} && GIT_SSH_COMMAND="${sshCommand}" git pull origin ${branch}`;
    await execAsync(pullCmd, { timeout: 120000 });
    console.log(`✅ ${resourceName} ready on branch ${branch}`);
  }

  getRepoPath(resourceName: string): string {
    const reposPath = process.env.REPOS_PATH || '/opt/spawner/repos';
    return path.join(reposPath, resourceName);
  }
}
