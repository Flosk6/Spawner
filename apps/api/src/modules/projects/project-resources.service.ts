import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectResource } from '../../entities/project-resource.entity';
import { ProjectsService } from './projects.service';
import { EnvVarsParser } from '../../common/env-vars.parser';
import { validateResourceLimits } from '@spawner/utils';
import { MAX_RESOURCE_LIMITS } from '@spawner/config';

@Injectable()
export class ProjectResourcesService {
  constructor(
    @InjectRepository(ProjectResource)
    private resourceRepository: Repository<ProjectResource>,
    private projectsService: ProjectsService,
  ) {}

  async findAll(projectId: number): Promise<ProjectResource[]> {
    // Verify project exists
    await this.projectsService.findOne(projectId);

    return this.resourceRepository.find({
      where: { projectId },
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(projectId: number, id: number): Promise<ProjectResource> {
    const resource = await this.resourceRepository.findOne({
      where: { id, projectId },
    });

    if (!resource) {
      throw new NotFoundException(`Resource with ID ${id} not found`);
    }

    return resource;
  }

  async create(
    projectId: number,
    data: {
      name: string;
      type: 'laravel-api' | 'nextjs-front' | 'mysql-db';
      gitRepo?: string;
      defaultBranch?: string;
      dbResourceId?: number;
      apiResourceId?: number;
      staticEnvVars?: string;
      postBuildCommands?: string[];
      resourceLimits?: {
        cpu?: string;
        memory?: string;
        cpuReservation?: string;
        memoryReservation?: string;
      };
      exposedPort?: number;
    },
  ): Promise<ProjectResource> {
    await this.projectsService.findOne(projectId);

    if (data.resourceLimits) {
      try {
        validateResourceLimits(data.resourceLimits, MAX_RESOURCE_LIMITS);
      } catch (error) {
        throw new BadRequestException(error.message);
      }
    }

    const staticEnvVars = data.staticEnvVars
      ? EnvVarsParser.parse(data.staticEnvVars)
      : {};

    const resource = this.resourceRepository.create({
      projectId,
      name: data.name,
      type: data.type,
      gitRepo: data.gitRepo || null,
      defaultBranch: data.defaultBranch || null,
      dbResourceId: data.dbResourceId || null,
      apiResourceId: data.apiResourceId || null,
      staticEnvVars,
      postBuildCommands: data.postBuildCommands || [],
      resourceLimits: data.resourceLimits || null,
      exposedPort: data.exposedPort || null,
    });

    return this.resourceRepository.save(resource);
  }

  async update(
    projectId: number,
    id: number,
    data: {
      name?: string;
      type?: 'laravel-api' | 'nextjs-front' | 'mysql-db';
      gitRepo?: string;
      defaultBranch?: string;
      dbResourceId?: number;
      apiResourceId?: number;
      staticEnvVars?: string;
      postBuildCommands?: string[];
      resourceLimits?: {
        cpu?: string;
        memory?: string;
        cpuReservation?: string;
        memoryReservation?: string;
      };
      exposedPort?: number;
    },
  ): Promise<ProjectResource> {
    const resource = await this.findOne(projectId, id);

    if (data.resourceLimits !== undefined) {
      if (data.resourceLimits) {
        try {
          validateResourceLimits(data.resourceLimits, MAX_RESOURCE_LIMITS);
        } catch (error) {
          throw new BadRequestException(error.message);
        }
      }
      resource.resourceLimits = data.resourceLimits || null;
    }

    if (data.staticEnvVars !== undefined) {
      resource.staticEnvVars = data.staticEnvVars
        ? EnvVarsParser.parse(data.staticEnvVars)
        : {};
    }

    if (data.name !== undefined) resource.name = data.name;
    if (data.type !== undefined) resource.type = data.type;
    if (data.gitRepo !== undefined) resource.gitRepo = data.gitRepo || null;
    if (data.defaultBranch !== undefined) resource.defaultBranch = data.defaultBranch || null;
    if (data.dbResourceId !== undefined) resource.dbResourceId = data.dbResourceId || null;
    if (data.apiResourceId !== undefined) resource.apiResourceId = data.apiResourceId || null;
    if (data.postBuildCommands !== undefined) resource.postBuildCommands = data.postBuildCommands || [];
    if (data.exposedPort !== undefined) resource.exposedPort = data.exposedPort || null;

    return this.resourceRepository.save(resource);
  }

  async delete(projectId: number, id: number): Promise<void> {
    const resource = await this.findOne(projectId, id);
    await this.resourceRepository.remove(resource);
  }
}
