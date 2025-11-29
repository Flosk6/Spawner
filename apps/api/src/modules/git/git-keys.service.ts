import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

export interface RepoKeyInfo {
  gitRepo: string;
  keyExists: boolean;
  publicKey?: string;
  usedBy: Array<{
    projectId: number;
    projectName: string;
    resourceId: number;
    resourceName: string;
  }>;
}

@Injectable()
export class GitKeysService {
  private readonly keysPath: string;

  constructor(private prisma: PrismaService) {
    this.keysPath = process.env.GIT_KEYS_PATH || '/opt/spawner/git-keys';

    // Ensure keys directory exists
    if (!fs.existsSync(this.keysPath)) {
      fs.mkdirSync(this.keysPath, { recursive: true });
    }
  }

  /**
   * Get all git repositories from all projects with their key status
   * Deduplicates repos - each unique repo URL appears only once
   */
  async getAllReposWithKeys(): Promise<RepoKeyInfo[]> {
    const resources = await this.prisma.projectResource.findMany({
      where: {
        type: {
          in: ['laravel-api', 'nextjs-front'],
        },
      },
      include: {
        project: true,
      },
    });

    // Group resources by git repo URL
    const repoMap = new Map<string, RepoKeyInfo>();

    for (const resource of resources) {
      if (!resource.gitRepo) continue;

      const gitRepo = resource.gitRepo;

      if (!repoMap.has(gitRepo)) {
        // First time seeing this repo - check if key exists
        const keyName = this.getKeyNameForRepo(gitRepo);
        const keyPath = path.join(this.keysPath, keyName);
        const keyExists = fs.existsSync(keyPath);

        let publicKey: string | undefined;
        if (keyExists) {
          try {
            publicKey = fs.readFileSync(`${keyPath}.pub`, 'utf-8').trim();
          } catch (error) {
            console.error(`Error reading public key for ${gitRepo}:`, error);
          }
        }

        repoMap.set(gitRepo, {
          gitRepo,
          keyExists,
          publicKey,
          usedBy: [],
        });
      }

      // Add this resource to the usedBy list
      repoMap.get(gitRepo)!.usedBy.push({
        projectId: resource.projectId,
        projectName: resource.project?.name || 'Unknown',
        resourceId: resource.id,
        resourceName: resource.name,
      });
    }

    // Convert map to array and sort by git repo URL
    return Array.from(repoMap.values()).sort((a, b) =>
      a.gitRepo.localeCompare(b.gitRepo)
    );
  }

  /**
   * Generate SSH key for a specific repository
   */
  async generateKeyForRepo(gitRepo: string): Promise<{ publicKey: string; privateKeyPath: string }> {
    const keyName = this.getKeyNameForRepo(gitRepo);
    const keyPath = path.join(this.keysPath, keyName);

    // Remove existing key if present
    if (fs.existsSync(keyPath)) {
      fs.unlinkSync(keyPath);
      fs.unlinkSync(`${keyPath}.pub`);
    }

    // Generate new ed25519 key
    const comment = `spawner-${keyName}`;
    const command = `ssh-keygen -t ed25519 -C "${comment}" -f "${keyPath}" -N ""`;

    try {
      await execAsync(command);

      const publicKey = fs.readFileSync(`${keyPath}.pub`, 'utf-8').trim();

      return {
        publicKey,
        privateKeyPath: keyPath,
      };
    } catch (error) {
      throw new Error(`Failed to generate SSH key: ${error.message}`);
    }
  }

  /**
   * Get the private key path for a specific git repository
   */
  getKeyPathForRepo(gitRepo: string): string {
    const keyName = this.getKeyNameForRepo(gitRepo);
    return path.join(this.keysPath, keyName);
  }

  /**
   * Convert git repo URL to a safe key filename
   */
  private getKeyNameForRepo(gitRepo: string): string {
    // Extract repo identifier from URL
    // git@github.com:org/repo.git -> github_com_org_repo
    // https://github.com/org/repo.git -> github_com_org_repo

    let identifier = gitRepo
      .replace(/^git@/, '')
      .replace(/^https?:\/\//, '')
      .replace(/\.git$/, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .toLowerCase();

    return `id_${identifier}`;
  }
}
