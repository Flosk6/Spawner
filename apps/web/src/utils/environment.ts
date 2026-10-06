import type { GitDeploy } from '../services/api';
import type { Environment, EnvironmentStatus } from '../types';

export type StatusTone = 'ready' | 'busy' | 'stopped' | 'failed';

/** Statuses during which a job is working on the environment. */
const BUSY: EnvironmentStatus[] = ['queued', 'preparing', 'validating', 'building', 'seeding', 'routing', 'stopping', 'starting', 'deleting'];

export function isBusy(status: EnvironmentStatus): boolean {
  return BUSY.includes(status);
}

export function statusTone(status: EnvironmentStatus): StatusTone {
  if (status === 'ready') {
    return 'ready';
  }
  if (status === 'failed') {
    return 'failed';
  }
  return isBusy(status) ? 'busy' : 'stopped';
}

/** Tailwind classes of each tone: dot, text and card border. */
export const TONE_CLASSES: Record<StatusTone, { dot: string; text: string; border: string }> = {
  ready: {
    dot: 'bg-green-500',
    text: 'text-green-600 dark:text-green-400',
    border: 'bg-gradient-to-br from-emerald-500 via-green-500 to-teal-600 hover:shadow-green-500/20',
  },
  busy: {
    dot: 'bg-blue-500',
    text: 'text-blue-600 dark:text-blue-400',
    border: 'bg-gradient-to-br from-blue-500 via-cyan-500 to-sky-600 hover:shadow-blue-500/20',
  },
  stopped: {
    dot: 'bg-slate-400',
    text: 'text-slate-500 dark:text-slate-400',
    border: 'bg-gradient-to-br from-slate-400 via-slate-500 to-slate-600 hover:shadow-slate-500/20',
  },
  failed: {
    dot: 'bg-red-500',
    text: 'text-red-600 dark:text-red-400',
    border: 'bg-gradient-to-br from-red-500 via-rose-500 to-pink-600 hover:shadow-red-500/20',
  },
};

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
