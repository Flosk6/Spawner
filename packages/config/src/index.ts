import type { ResourceType } from '@spawner/types';

// Environment variable names
export const ENV_VARS = {
  DB_HOST: 'DB_HOST',
  DB_PORT: 'DB_PORT',
  DB_DATABASE: 'DB_DATABASE',
  DB_USERNAME: 'DB_USERNAME',
  DB_PASSWORD: 'DB_PASSWORD',
  MYSQL_DATABASE: 'MYSQL_DATABASE',
  MYSQL_USER: 'MYSQL_USER',
  MYSQL_PASSWORD: 'MYSQL_PASSWORD',
  MYSQL_ROOT_PASSWORD: 'MYSQL_ROOT_PASSWORD',
  NEXT_PUBLIC_API_URL: 'NEXT_PUBLIC_API_URL',
} as const;

// Default values
export const DEFAULTS = {
  DB_PORT: 3306,
  DB_USERNAME: 'spawner',
  DB_PASSWORD: 'spawner_pass',
  MYSQL_ROOT_PASSWORD: 'root_pass',
} as const;

// Validation regex
export const VALIDATION = {
  ENVIRONMENT_NAME: /^[a-z0-9-]+$/,
  BRANCH_NAME: /^[a-zA-Z0-9/_.-]+$/,
} as const;

// Docker configuration
export const DOCKER = {
  NETWORK_PREFIX: 'net-',
  VOLUME_SUFFIX: '-data',
  COMPOSE_PROJECT_PREFIX: 'env-',
} as const;

// Resource type configurations
export const RESOURCE_CONFIGS: Record<ResourceType, {
  requiresGit: boolean;
  requiresDb: boolean;
  requiresApi: boolean;
}> = {
  'laravel-api': {
    requiresGit: true,
    requiresDb: true,
    requiresApi: false,
  },
  'nextjs-front': {
    requiresGit: true,
    requiresDb: false,
    requiresApi: true,
  },
  'mysql-db': {
    requiresGit: false,
    requiresDb: false,
    requiresApi: false,
  },
};

// Helper functions
export function isGitResource(type: ResourceType): boolean {
  return RESOURCE_CONFIGS[type].requiresGit;
}

export function requiresDatabase(type: ResourceType): boolean {
  return RESOURCE_CONFIGS[type].requiresDb;
}

export function requiresApi(type: ResourceType): boolean {
  return RESOURCE_CONFIGS[type].requiresApi;
}
