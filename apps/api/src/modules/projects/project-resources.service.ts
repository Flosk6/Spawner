import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { ProjectsService } from './projects.service';
import { EnvVarsParser } from '../../common/env-vars.parser';
import { validateResourceLimits } from '@spawner/utils';
import { MAX_RESOURCE_LIMITS } from '@spawner/config';

@Injectable()
export class ProjectResourcesService {
  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
  ) {}

  async findAll(projectId: number) {
    await this.projectsService.findOne(projectId);

    return this.prisma.projectResource.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(projectId: number, id: number) {
    const resource = await this.prisma.projectResource.findUnique({
      where: { id },
    });

    if (!resource || resource.projectId !== projectId) {
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
  ) {
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

    return this.prisma.projectResource.create({
      data: {
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
      },
    });
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
  ) {
    await this.findOne(projectId, id);

    if (data.resourceLimits !== undefined && data.resourceLimits) {
      try {
        validateResourceLimits(data.resourceLimits, MAX_RESOURCE_LIMITS);
      } catch (error) {
        throw new BadRequestException(error.message);
      }
    }

    const updateData: any = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.gitRepo !== undefined) updateData.gitRepo = data.gitRepo || null;
    if (data.defaultBranch !== undefined) updateData.defaultBranch = data.defaultBranch || null;
    if (data.dbResourceId !== undefined) updateData.dbResourceId = data.dbResourceId || null;
    if (data.apiResourceId !== undefined) updateData.apiResourceId = data.apiResourceId || null;
    if (data.postBuildCommands !== undefined) updateData.postBuildCommands = data.postBuildCommands || [];
    if (data.exposedPort !== undefined) updateData.exposedPort = data.exposedPort || null;
    if (data.resourceLimits !== undefined) updateData.resourceLimits = data.resourceLimits || null;

    if (data.staticEnvVars !== undefined) {
      updateData.staticEnvVars = data.staticEnvVars
        ? EnvVarsParser.parse(data.staticEnvVars)
        : {};
    }

    return this.prisma.projectResource.update({
      where: { id },
      data: updateData,
    });
  }

  async delete(projectId: number, id: number) {
    await this.findOne(projectId, id);

    await this.prisma.projectResource.delete({
      where: { id },
    });
  }
}
