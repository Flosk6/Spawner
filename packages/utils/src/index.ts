import { VALIDATION } from '@spawner/config';

/**
 * Validates an environment name
 * Must be lowercase alphanumeric with hyphens only
 */
export function validateEnvironmentName(name: string): boolean {
  return VALIDATION.ENVIRONMENT_NAME.test(name);
}

/**
 * Validates a git branch name
 */
export function validateBranchName(branch: string): boolean {
  return VALIDATION.BRANCH_NAME.test(branch);
}

/**
 * Generates a URL for a resource in an environment
 * Format: <resourceName>.<envName>.<baseDomain>
 */
export function generateResourceUrl(
  resourceName: string,
  envName: string,
  baseDomain: string,
): string {
  return `${resourceName}.${envName}.${baseDomain}`;
}

/**
 * Generates a Docker service name
 * Format: <resourceName>-<envName>
 */
export function generateServiceName(resourceName: string, envName: string): string {
  return `${resourceName}-${envName}`;
}

/**
 * Generates a Docker network name
 * Format: net-<envName>
 */
export function generateNetworkName(envName: string): string {
  return `net-${envName}`;
}

/**
 * Generates a Docker volume name for database
 * Format: <dbResourceName>-<envName>-data
 */
export function generateVolumeName(dbResourceName: string, envName: string): string {
  return `${dbResourceName}-${envName}-data`;
}

/**
 * Generates a Docker Compose project name
 * Format: env-<envName>
 */
export function generateComposeProjectName(envName: string): string {
  return `env-${envName}`;
}

/**
 * Sanitizes a string for use in shell commands
 */
export function sanitizeShellArg(arg: string): string {
  // Remove or escape potentially dangerous characters
  return arg.replace(/[;&|`$(){}[\]<>]/g, '');
}

/**
 * Formats a date to ISO string
 */
export function formatDate(date: Date | string): string {
  if (typeof date === 'string') {
    return date;
  }
  return date.toISOString();
}

/**
 * Parses environment config JSON safely
 */
export function parseConfigJson<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
