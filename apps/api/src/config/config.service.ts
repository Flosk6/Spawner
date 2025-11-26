import { Injectable, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';

export interface ProjectResource {
  name: string;
  type: 'laravel-api' | 'nextjs-front' | 'mysql-db';
  gitRepo?: string;
  defaultBranch?: string;
  dbResource?: string;
  apiResource?: string;
  postBuildCommands?: string[];
  resourceLimits?: {
    cpu?: string;
    memory?: string;
    cpuReservation?: string;
    memoryReservation?: string;
  };
  exposedPort?: number;
}

export interface ProjectConfig {
  baseDomain: string;
  resources: ProjectResource[];
}

@Injectable()
export class ConfigService implements OnModuleInit {
  private projectConfig: ProjectConfig;
  private readonly configPath: string;

  constructor() {
    this.configPath = process.env.PROJECT_CONFIG_PATH || '/opt/spawner/project.config.yml';
  }

  async onModuleInit() {
    await this.loadConfig();
  }

  private async loadConfig() {
    try {
      const fileContent = fs.readFileSync(this.configPath, 'utf8');
      this.projectConfig = yaml.load(fileContent) as ProjectConfig;
      this.validateConfig();
      console.log(`✓ Project config loaded: ${this.projectConfig.resources.length} resources`);
    } catch (error) {
      console.error('Failed to load project config:', error.message);
      throw error;
    }
  }

  private validateConfig() {
    if (!this.projectConfig.baseDomain) {
      throw new Error('baseDomain is required in project.config.yml');
    }

    if (!Array.isArray(this.projectConfig.resources) || this.projectConfig.resources.length === 0) {
      throw new Error('resources array is required and must not be empty');
    }

    const names = new Set<string>();
    for (const resource of this.projectConfig.resources) {
      if (!resource.name) {
        throw new Error('Each resource must have a name');
      }
      if (names.has(resource.name)) {
        throw new Error(`Duplicate resource name: ${resource.name}`);
      }
      names.add(resource.name);

      if (!['laravel-api', 'nextjs-front', 'mysql-db'].includes(resource.type)) {
        throw new Error(`Invalid resource type for ${resource.name}: ${resource.type}`);
      }

      if (resource.type === 'laravel-api') {
        if (!resource.gitRepo) throw new Error(`gitRepo required for ${resource.name}`);
        if (!resource.dbResource) throw new Error(`dbResource required for ${resource.name}`);
      }

      if (resource.type === 'nextjs-front') {
        if (!resource.gitRepo) throw new Error(`gitRepo required for ${resource.name}`);
        if (!resource.apiResource) throw new Error(`apiResource required for ${resource.name}`);
      }
    }
  }

  getConfig(): ProjectConfig {
    return this.projectConfig;
  }

  getBaseDomain(): string {
    return this.projectConfig.baseDomain;
  }

  getResources(): ProjectResource[] {
    return this.projectConfig.resources;
  }

  getResourceByName(name: string): ProjectResource | undefined {
    return this.projectConfig.resources.find(r => r.name === name);
  }

  getGitResources(): ProjectResource[] {
    return this.projectConfig.resources.filter(r =>
      r.type === 'laravel-api' || r.type === 'nextjs-front'
    );
  }
}
