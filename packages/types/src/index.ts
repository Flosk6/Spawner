// Resource Types
export type ResourceType = 'laravel-api' | 'nextjs-front' | 'mysql-db';

// Environment Status
export type EnvironmentStatus = 'creating' | 'running' | 'failed' | 'deleting' | 'paused' | 'updating';

// User Role
export type UserRole = 'user' | 'admin';

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
  baseImages?: string[];
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

// Environment
export interface Environment {
  id: string;
  name: string;
  projectId?: number;
  status: EnvironmentStatus;
  createdAt: string | Date;
  branches?: Record<string, string>;
  project?: {
    id: number;
    name: string;
    baseDomain: string;
  };
  resources?: EnvironmentResource[];
}

export interface EnvironmentDetail extends Environment {
  resources: EnvironmentResource[];
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

// Authentication
export interface User {
  id: number;
  githubId: string;
  username: string;
  email?: string;
  avatarUrl?: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface AuthStatus {
  authenticated: boolean;
  user: User | null;
}

// DTOs
export interface CreateEnvironmentDto {
  name: string;
  branches: Record<string, string>;
  projectId?: number;
}

export interface UpdateEnvironmentDto {
  branches?: Record<string, string>;
}

export interface EnvironmentLogsQuery {
  since?: string;
  tail?: number;
}

// Environment Actions
export type EnvironmentActionType = 'pause' | 'resume' | 'restart' | 'update' | 'restart_resource';
export type EnvironmentActionStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface EnvironmentAction {
  id: string;
  environmentId: string;
  action: EnvironmentActionType;
  status: EnvironmentActionStatus;
  metadata?: {
    resourceName?: string;
    branches?: Record<string, string>;
    error?: string;
  };
  startedAt: Date | string;
  completedAt?: Date | string;
}

// Spawner Repository Configuration
export interface SpawnerConfig {
  baseImages?: string[];
  dockerfile?: string;
  exposedPort?: number;
  healthCheck?: {
    path: string;
    timeout: number;
  };
  postBuildCommands?: string[];
  resourceLimits?: {
    cpu?: string;
    memory?: string;
    cpuReservation?: string;
    memoryReservation?: string;
  };
}
