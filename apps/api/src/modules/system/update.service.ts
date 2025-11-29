import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export enum PatchType {
  SECURITY = 'security',
  BUGFIX = 'bugfix',
  FEATURE = 'feature',
}

export enum PatchStatus {
  PENDING = 'pending',
  APPLIED = 'applied',
  FAILED = 'failed',
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  changelog: string;
  publishedAt: Date;
  updateAvailable: boolean;
}

export interface PackageUpdate {
  name: string;
  currentVersion: string;
  latestVersion: string;
  type: PatchType;
}

@Injectable()
export class UpdateService {
  private readonly logger = new Logger(UpdateService.name);
  private readonly GITHUB_REPO = process.env.GITHUB_REPO || 'your-org/spawner';
  private readonly PACKAGE_JSON_PATH = path.join(__dirname, '../../../package.json');

  constructor(private prisma: PrismaService) {}

  async getInstalledVersion(): Promise<string> {
    try {
      const packageJson = await fs.readFile(this.PACKAGE_JSON_PATH, 'utf-8');
      const { version } = JSON.parse(packageJson);
      return version;
    } catch (error) {
      this.logger.error('Failed to read installed version', error);
      return '0.0.0';
    }
  }

  async checkForUpdates(): Promise<UpdateInfo> {
    try {
      const currentVersion = await this.getInstalledVersion();

      const response = await fetch(
        `https://api.github.com/repos/${this.GITHUB_REPO}/releases/latest`,
        {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Spawner-Update-Checker',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}`);
      }

      const release = await response.json();
      const latestVersion = release.tag_name.replace(/^v/, '');
      const updateAvailable = this.compareVersions(latestVersion, currentVersion) > 0;

      if (updateAvailable) {
        await this.saveSetting('LATEST_VERSION', latestVersion);
        await this.saveSetting('LATEST_VERSION_CHANGELOG', release.body);
        this.logger.log(`Update available: ${currentVersion} -> ${latestVersion}`);
      }

      return {
        currentVersion,
        latestVersion,
        changelog: release.body,
        publishedAt: new Date(release.published_at),
        updateAvailable,
      };
    } catch (error) {
      this.logger.error('Failed to check for updates', error);
      throw error;
    }
  }

  async performUpdate(version?: string): Promise<void> {
    try {
      this.logger.log(`Starting update process${version ? ` to version ${version}` : ''}`);

      const scriptPath = path.join(__dirname, '../../../../scripts/update.sh');
      const command = version ? `bash ${scriptPath} ${version}` : `bash ${scriptPath}`;

      const { stdout, stderr } = await execAsync(command, {
        timeout: 300000,
      });

      this.logger.log('Update stdout:', stdout);
      if (stderr) {
        this.logger.warn('Update stderr:', stderr);
      }

      this.logger.log('Update completed successfully');
    } catch (error) {
      this.logger.error('Update failed', error);
      throw error;
    }
  }

  async checkSystemPackages(): Promise<PackageUpdate[]> {
    try {
      const packageManager = await this.detectPackageManager();
      let updates: PackageUpdate[] = [];

      switch (packageManager) {
        case 'apt':
          updates = await this.checkAptUpdates();
          break;
        case 'dnf':
          updates = await this.checkDnfUpdates();
          break;
        case 'zypper':
          updates = await this.checkZypperUpdates();
          break;
        default:
          throw new Error('Unsupported package manager');
      }

      for (const update of updates) {
        const existingPatch = await this.prisma.serverPatch.findFirst({
          where: {
            packageName: update.name,
            latestVersion: update.latestVersion,
          },
        });

        if (!existingPatch) {
          await this.prisma.serverPatch.create({
            data: {
              packageName: update.name,
              currentVersion: update.currentVersion,
              latestVersion: update.latestVersion,
              type: update.type,
              status: PatchStatus.PENDING,
            },
          });
        }
      }

      return updates;
    } catch (error) {
      this.logger.error('Failed to check system packages', error);
      throw error;
    }
  }

  async applyPatch(patchId: number): Promise<void> {
    const patch = await this.prisma.serverPatch.findUnique({
      where: { id: patchId },
    });

    if (!patch) {
      throw new Error(`Patch ${patchId} not found`);
    }

    try {
      const packageManager = await this.detectPackageManager();

      let command: string;
      switch (packageManager) {
        case 'apt':
          command = `DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade ${patch.packageName}`;
          break;
        case 'dnf':
          command = `dnf upgrade -y ${patch.packageName}`;
          break;
        case 'zypper':
          command = `zypper update -y ${patch.packageName}`;
          break;
        default:
          throw new Error('Unsupported package manager');
      }

      await execAsync(command, { timeout: 300000 });

      await this.prisma.serverPatch.update({
        where: { id: patchId },
        data: {
          status: PatchStatus.APPLIED,
          appliedAt: new Date(),
        },
      });

      this.logger.log(`Patch applied successfully: ${patch.packageName}`);
    } catch (error) {
      await this.prisma.serverPatch.update({
        where: { id: patchId },
        data: {
          status: PatchStatus.FAILED,
        },
      });

      this.logger.error(`Failed to apply patch ${patchId}`, error);
      throw error;
    }
  }

  async applyAllPatches(): Promise<void> {
    const pendingPatches = await this.prisma.serverPatch.findMany({
      where: { status: PatchStatus.PENDING },
    });

    for (const patch of pendingPatches) {
      try {
        await this.applyPatch(patch.id);
      } catch (error) {
        this.logger.error(`Failed to apply patch ${patch.id}`, error);
      }
    }
  }

  async getPendingPatches() {
    return this.prisma.serverPatch.findMany({
      where: { status: PatchStatus.PENDING },
      orderBy: { detectedAt: 'desc' },
    });
  }

  private async detectPackageManager(): Promise<string> {
    const managers = ['apt-get', 'dnf', 'zypper'];

    for (const manager of managers) {
      try {
        await execAsync(`which ${manager}`);
        return manager.replace('-get', '');
      } catch {
        continue;
      }
    }

    throw new Error('No supported package manager found');
  }

  private async checkAptUpdates(): Promise<PackageUpdate[]> {
    await execAsync('apt-get update -qq', { timeout: 60000 });
    const { stdout } = await execAsync('apt list --upgradable 2>/dev/null | grep -v "Listing"');

    return this.parseAptOutput(stdout);
  }

  private async checkDnfUpdates(): Promise<PackageUpdate[]> {
    const { stdout } = await execAsync('dnf check-update -q', { timeout: 60000 });
    return this.parseDnfOutput(stdout);
  }

  private async checkZypperUpdates(): Promise<PackageUpdate[]> {
    const { stdout } = await execAsync('zypper list-updates', { timeout: 60000 });
    return this.parseZypperOutput(stdout);
  }

  private parseAptOutput(output: string): PackageUpdate[] {
    const updates: PackageUpdate[] = [];
    const lines = output.trim().split('\n');

    for (const line of lines) {
      if (!line) continue;

      const match = line.match(/^(\S+)\/\S+\s+(\S+)\s+\S+\s+\[upgradable from:\s+(\S+)\]/);
      if (match) {
        const [, name, latestVersion, currentVersion] = match;
        updates.push({
          name,
          currentVersion,
          latestVersion,
          type: this.classifyPackageType(name),
        });
      }
    }

    return updates;
  }

  private parseDnfOutput(output: string): PackageUpdate[] {
    const updates: PackageUpdate[] = [];
    const lines = output.trim().split('\n').filter(line => line && !line.startsWith('Last metadata'));

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const [name, latestVersion, currentVersion] = parts;
        updates.push({
          name,
          currentVersion: currentVersion || 'unknown',
          latestVersion,
          type: this.classifyPackageType(name),
        });
      }
    }

    return updates;
  }

  private parseZypperOutput(output: string): PackageUpdate[] {
    const updates: PackageUpdate[] = [];
    const lines = output.trim().split('\n').slice(4);

    for (const line of lines) {
      if (!line.startsWith('v')) continue;

      const parts = line.trim().split(/\s+\|\s+/);
      if (parts.length >= 4) {
        const name = parts[2];
        const currentVersion = parts[3];
        const latestVersion = parts[4];

        updates.push({
          name,
          currentVersion,
          latestVersion,
          type: this.classifyPackageType(name),
        });
      }
    }

    return updates;
  }

  private classifyPackageType(packageName: string): PatchType {
    const securityKeywords = ['security', 'cve', 'vulnerability', 'openssl', 'openssh'];
    const lowercaseName = packageName.toLowerCase();

    if (securityKeywords.some(keyword => lowercaseName.includes(keyword))) {
      return PatchType.SECURITY;
    }

    return PatchType.FEATURE;
  }

  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const num1 = parts1[i] || 0;
      const num2 = parts2[i] || 0;

      if (num1 > num2) return 1;
      if (num1 < num2) return -1;
    }

    return 0;
  }

  private async saveSetting(key: string, value: string): Promise<void> {
    await this.prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value, description: null },
    });
  }

  async getSetting(key: string): Promise<string | null> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key } });
    return setting?.value || null;
  }
}
