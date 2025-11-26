// Resource Types
export type ResourceType = 'laravel-api' | 'nextjs-front' | 'mysql-db';

// Environment Status
export type EnvironmentStatus = 'creating' | 'running' | 'failed' | 'deleting';

// Project Configuration
export interface ProjectConfig {
  baseDomain: string;
  resources: ProjectResource[];
}

export interface ProjectResource {
  name: string;
  type: ResourceType;
  gitRepo?: string;
  defaultBranch?: string;
  dbResource?: string;
  apiResource?: string;
}

// Environment
export interface Environment {
  id: string;
  name: string;
  projectId?: number;
  status: EnvironmentStatus;
  createdAt: string | Date;
  branches?: Record<string, string>;
}

export interface EnvironmentDetail extends Environment {
  resources: EnvironmentResourceDetail[];
}

// Environment Resource
export interface EnvironmentResource {
  id: string;
  environmentId: string;
  resourceName: string;
  resourceType: ResourceType;
  branch: string | null;
  url: string | null;
  createdAt: string | Date;
}

export interface EnvironmentResourceDetail {
  name: string;
  type: ResourceType;
  branch: string | null;
  url: string | null;
  containerStatus: string;
}

// Git
export interface GitKeyInfo {
  exists: boolean;
  publicKey: string | null;
}

export interface GitTestResult {
  ok: boolean;
  message: string;
}

// DTOs
export interface CreateEnvironmentDto {
  name: string;
  branches: Record<string, string>;
  projectId?: number;
}

export interface EnvironmentLogsQuery {
  since?: string;
  tail?: number;
}
