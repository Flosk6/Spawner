import type { GitDeploy } from '../services/api';
import type { CreatedVia, Environment, EnvironmentStatus, User } from '../types';

export type StatusTone = 'ready' | 'degraded' | 'busy' | 'sleeping' | 'stopped' | 'failed';

/** Statuses during which a job is working on the environment. */
const BUSY: EnvironmentStatus[] = ['queued', 'preparing', 'validating', 'building', 'seeding', 'routing', 'stopping', 'starting', 'waking', 'deleting'];

export function isBusy(status: EnvironmentStatus): boolean {
  return BUSY.includes(status);
}

export function statusTone(status: EnvironmentStatus): StatusTone {
  if (status === 'ready' || status === 'degraded' || status === 'sleeping' || status === 'failed') {
    return status;
  }
  return isBusy(status) ? 'busy' : 'stopped';
}

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'sleep' | 'muted' | 'accent';

/** The tone of each group of statuses: the `tone-*` classes of style.css. */
export const STATUS_TONES: Record<StatusTone, Tone> = {
  ready: 'ok',
  degraded: 'warn',
  sleeping: 'sleep',
  busy: 'info',
  stopped: 'muted',
  failed: 'danger',
};

/** "Ready", "Building", "Waking": a status, or a container's state. */
export function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export const ENV_SLUG_MAX_LENGTH = 29;
export const ENV_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Suggests an environment name from a branch ("feat/Login" gives
 * "feat-login"). The API has the last word on what is valid.
 */
export function suggestEnvSlug(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, ENV_SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
}

export const PROJECT_SLUG_MAX_LENGTH = 20;
export const PROJECT_SLUG_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * The request that redeploys an environment from the same branches, at
 * their latest commit; null when a source was uploaded from a worktree,
 * which only the CLI can send again.
 */
export function redeployRequest(environment: Environment): GitDeploy | null {
  if (environment.sources.some((source) => source.origin === 'upload')) {
    return null;
  }
  const deploy: GitDeploy = { sources: {} };
  for (const source of environment.sources) {
    if (source.primary) {
      deploy.ref = source.ref ?? undefined;
    } else if (source.ref) {
      deploy.sources![source.name] = source.ref;
    }
  }
  return deploy;
}

/**
 * Members act on their own environments; admins on all of them. The API has
 * the last word; the interface only hides what would be refused.
 */
export function canManage(user: User | null, environment: Environment): boolean {
  return user !== null && (user.role === 'admin' || environment.owner?.id === user.id);
}

/** Where an environment was created from, when no token names it: "from the CLI". */
export function originLabel(createdVia: CreatedVia): string {
  return { ui: 'from the dashboard', cli: 'from the CLI', mcp: 'from MCP', api: 'from the API' }[createdVia];
}

/** Who created an environment and through what: "Ada via claude-laptop". */
export function ownerLabel(environment: Environment): string {
  if (!environment.owner) {
    return 'installation token';
  }
  return environment.tokenName ? `${environment.owner.name} via ${environment.tokenName}` : environment.owner.name;
}
