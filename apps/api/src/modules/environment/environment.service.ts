import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Environment } from '../../entities/environment.entity';
import { EnvironmentResource } from '../../entities/environment-resource.entity';
import { Project } from '../../entities/project.entity';
import { Observable } from 'rxjs';
import { MessageEvent } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { sanitizeShellArg } from '@spawner/utils';
import type { EnvironmentStatus, ResourceType } from '@spawner/types';
import { isGitResource } from '@spawner/config';
import { DockerComposeGenerator } from '../../common/docker-compose.generator';
import { EnvironmentLogsEmitter } from '../../common/environment-logs.emitter';
import { EnvVarsGenerator } from '../../common/env-vars.generator';

const execAsync = promisify(exec);

@Injectable()
export class EnvironmentService {
  constructor(
    @InjectRepository(Environment)
    private environmentRepository: Repository<Environment>,
    @InjectRepository(EnvironmentResource)
    private resourceRepository: Repository<EnvironmentResource>,
    @InjectRepository(Project)
    private projectRepository: Repository<Project>,
    private logsEmitter: EnvironmentLogsEmitter,
  ) {}

  async findAll(): Promise<Environment[]> {
    return this.environmentRepository.find({
      relations: ['resources', 'project'],
      order: { createdAt: 'DESC' },
    });
  }

  async findByProject(projectId: number): Promise<Environment[]> {
    return this.environmentRepository.find({
      where: { projectId },
      relations: ['resources'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Environment> {
    const environment = await this.environmentRepository.findOne({
      where: { id },
      relations: ['resources', 'project'],
    });

    if (!environment) {
      throw new NotFoundException(`Environment with ID ${id} not found`);
    }

    return environment;
  }

  async createForProject(
    projectId: number,
    name: string,
    branches: Record<string, string>,
    localMode?: boolean,
  ): Promise<Environment> {
    // Load project with resources
    const project = await this.projectRepository.findOne({
      where: { id: projectId },
      relations: ['resources'],
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    // Check for duplicate environment name
    const existing = await this.environmentRepository.findOne({
      where: { name },
    });

    if (existing) {
      throw new ConflictException(`Environment with name "${name}" already exists`);
    }

    // Validate branches for git resources
    const gitResources = project.resources.filter((r) =>
      isGitResource(r.type as ResourceType),
    );
    for (const resource of gitResources) {
      if (!branches[resource.name]) {
        throw new ConflictException(
          `Branch for resource "${resource.name}" is required`,
        );
      }
    }

    // Create environment record
    const envId = uuidv4();
    const environment = this.environmentRepository.create({
      id: envId,
      name,
      projectId,
      status: 'creating' as EnvironmentStatus,
      configJson: JSON.stringify({ branches, localMode: localMode || false }),
    });

    await this.environmentRepository.save(environment);

    // Start async creation process
    this.createEnvironmentAsync(
      envId,
      project,
      name,
      branches,
      localMode || false,
    ).catch(async (error) => {
      console.error(`Failed to create environment ${name}:`, error);
      this.logsEmitter.error(envId, `Failed: ${error.message}`);
      await this.environmentRepository.update(envId, {
        status: 'failed' as EnvironmentStatus,
      });
    });

    return environment;
  }

  private async createEnvironmentAsync(
    envId: string,
    project: Project,
    envName: string,
    branches: Record<string, string>,
    localMode: boolean,
  ): Promise<void> {
    const log = (level: 'info' | 'success' | 'warning' | 'error', message: string) => {
      console.log(`[${envName}] ${message}`);
      this.logsEmitter.emitLog(envId, level, message);
    };

    try {
      log('info', 'Starting environment creation...');

      const envsPath = process.env.ENVS_PATH || '/opt/spawner/envs';
      const reposPath = process.env.REPOS_PATH || '/opt/spawner/repos';
      const gitKeysPath = process.env.GIT_KEYS_PATH || '/opt/spawner/git-keys';

      const envDir = path.join(envsPath, `${project.name}-${envName}`);

      log('info', `Creating environment directory: ${envDir}`);
      await fs.mkdir(envDir, { recursive: true });

      // Clone/update git repositories
      const gitResources = project.resources.filter((r) =>
        isGitResource(r.type as ResourceType),
      );

      for (const resource of gitResources) {
        const branch = branches[resource.name];
        const repoDir = path.join(reposPath, resource.name);

        log('info', `Processing git resource: ${resource.name} (branch: ${branch})`);

        const repoExists = await fs
          .access(repoDir)
          .then(() => true)
          .catch(() => false);

        if (!repoExists) {
          log('info', `Cloning repository for ${resource.name}...`);
          const sshCommand = `ssh -i ${path.join(gitKeysPath, 'id_spawner')} -o StrictHostKeyChecking=no`;
          await execAsync(
            `GIT_SSH_COMMAND="${sshCommand}" git clone ${sanitizeShellArg(resource.gitRepo)} ${sanitizeShellArg(repoDir)}`,
          );
        }

        log('info', `Checking out branch ${branch} for ${resource.name}...`);
        await execAsync(
          `cd ${sanitizeShellArg(repoDir)} && git fetch && git checkout ${sanitizeShellArg(branch)} && git pull`,
        );
      }

      // Load environment for env vars generation
      const environment = await this.environmentRepository.findOne({
        where: { id: envId },
      });

      // Generate port mappings for local mode
      const resourcePorts: Record<string, number> = {};
      if (localMode) {
        let portCounter = 8000;
        for (const resource of project.resources) {
          if (resource.type !== 'mysql-db') {
            resourcePorts[resource.name] = portCounter++;
          }
        }
      }

      // Generate environment variables for each resource
      const resourcesEnvVars: Record<string, Record<string, string>> = {};
      for (const resource of project.resources) {
        resourcesEnvVars[resource.name] = EnvVarsGenerator.generateForResource(
          resource,
          environment,
          project,
          project.resources,
          {},
          localMode,
          resourcePorts,
        );
      }

      // Generate docker-compose.yml
      log('info', 'Generating docker-compose.yml...');
      const generator = new DockerComposeGenerator(
        envName,
        project.baseDomain,
        project.resources as any[],
        branches,
        reposPath,
        resourcesEnvVars,
        localMode,
      );
      const composeContent = generator.generate();
      await fs.writeFile(path.join(envDir, 'docker-compose.yml'), composeContent);

      // Start containers
      log('info', 'Starting Docker containers...');
      const projectName = `env-${project.name}-${envName}`;
      await execAsync(
        `cd ${sanitizeShellArg(envDir)} && docker compose -p ${sanitizeShellArg(projectName)} up -d`,
      );

      // Create environment resources
      log('info', 'Creating environment resources...');
      for (const resource of project.resources) {
        const envResource = this.resourceRepository.create({
          id: `${envId}-${resource.name}`,
          environmentId: envId,
          resourceName: resource.name,
          resourceType: resource.type as ResourceType,
          url: this.generateResourceUrl(
            resource.name,
            resource.type as ResourceType,
            envName,
            project.baseDomain,
            localMode,
            resourcePorts,
          ),
          branch: branches[resource.name] || null,
        });
        await this.resourceRepository.save(envResource);
      }

      // Update environment status
      await this.environmentRepository.update(envId, {
        status: 'running' as EnvironmentStatus,
      });

      // Clear shared secrets
      EnvVarsGenerator.clearSharedSecrets(envId);

      log('success', 'Environment created successfully!');
    } catch (error) {
      log('error', `Failed to create environment: ${error.message}`);
      await this.environmentRepository.update(envId, {
        status: 'failed' as EnvironmentStatus,
      });
      throw error;
    }
  }

  private generateResourceUrl(
    resourceName: string,
    resourceType: ResourceType,
    envName: string,
    baseDomain: string,
    localMode?: boolean,
    resourcePorts?: Record<string, number>,
  ): string {
    if (resourceType === 'mysql-db') {
      return `mysql://${resourceName}-${envName}:3306`;
    }
    if (localMode && resourcePorts && resourcePorts[resourceName]) {
      return `http://localhost:${resourcePorts[resourceName]}`;
    }
    return `https://${resourceName}.${envName}.${baseDomain}`;
  }

  async delete(id: string): Promise<void> {
    const environment = await this.findOne(id);

    const envsPath = process.env.ENVS_PATH || '/opt/spawner/envs';
    const envDir = path.join(
      envsPath,
      `${environment.project.name}-${environment.name}`,
    );
    const projectName = `env-${environment.project.name}-${environment.name}`;

    try {
      // Stop and remove containers
      await execAsync(
        `cd ${sanitizeShellArg(envDir)} && docker compose -p ${sanitizeShellArg(projectName)} down -v`,
      );

      // Remove directory
      await fs.rm(envDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`Error cleaning up environment ${environment.name}:`, error);
    }

    // Remove from database
    await this.environmentRepository.remove(environment);
  }

  async getLogs(id: string, resourceName: string): Promise<{ logs: string }> {
    const environment = await this.findOne(id);
    const serviceName = `${resourceName}-${environment.name}`;
    const projectName = `env-${environment.project.name}-${environment.name}`;

    try {
      const { stdout } = await execAsync(
        `docker compose -p ${sanitizeShellArg(projectName)} logs --tail=500 ${sanitizeShellArg(serviceName)}`,
      );
      return { logs: stdout };
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to fetch logs: ${error.message}`,
      );
    }
  }

  async execCommand(
    id: string,
    resourceName: string,
    command: string,
  ): Promise<{ output: string }> {
    const environment = await this.findOne(id);
    const serviceName = `${resourceName}-${environment.name}`;
    const projectName = `env-${environment.project.name}-${environment.name}`;

    try {
      const { stdout, stderr } = await execAsync(
        `docker compose -p ${sanitizeShellArg(projectName)} exec -T ${sanitizeShellArg(serviceName)} ${sanitizeShellArg(command)}`,
      );
      return { output: stdout + stderr };
    } catch (error) {
      return { output: error.message };
    }
  }

  async streamLogs(id: string, resourceName: string): Promise<{ url: string }> {
    return { url: `/api/environments/${id}/logs/${resourceName}` };
  }

  streamCreationLogs(environmentId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const handler = (log: any) => {
        subscriber.next({
          data: JSON.stringify(log),
        } as MessageEvent);
      };

      this.logsEmitter.on(`logs:${environmentId}`, handler);

      // Send existing logs
      const existingLogs = this.logsEmitter.getLogs(environmentId);
      existingLogs.forEach((log) => {
        subscriber.next({
          data: JSON.stringify(log),
        } as MessageEvent);
      });

      return () => {
        this.logsEmitter.off(`logs:${environmentId}`, handler);
      };
    });
  }
}
