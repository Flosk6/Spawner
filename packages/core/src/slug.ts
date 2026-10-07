import { createHash } from 'crypto';
import type { Issue } from './errors';

/**
 * Maximum lengths keep every preview hostname,
 * "<exposure>--<env>--<project>", within the 63 characters of a DNS label.
 */
export const SLUG_MAX_LENGTH = {
  project: 20,
  env: 29,
  exposure: 10,
  source: 20,
} as const;

export type SlugKind = keyof typeof SLUG_MAX_LENGTH;

const SLUG_PATTERN: Record<SlugKind, RegExp> = {
  project: /^[a-z][a-z0-9-]*$/,
  env: /^[a-z0-9][a-z0-9-]*$/,
  exposure: /^[a-z][a-z0-9-]*$/,
  source: /^[a-z][a-z0-9-]*$/,
};

/**
 * Checks a project, environment, exposure or source name. Names never contain
 * "--" because it separates the parts of a hostname, and never end with "-".
 *
 * @returns An issue describing the problem, or null when the name is valid
 */
export function slugIssue(kind: SlugKind, value: unknown, path: string): Issue | null {
  const max = SLUG_MAX_LENGTH[kind];
  const rule =
    kind === 'env'
      ? 'lowercase letters, digits and single dashes'
      : 'lowercase letters, digits and single dashes, starting with a letter';
  if (typeof value !== 'string' || value.length === 0) {
    return { code: 'slug.invalid', path, message: `${kind} name is required` };
  }
  if (value.length > max) {
    return { code: 'slug.invalid', path, message: `${kind} name "${value}" is longer than ${max} characters` };
  }
  if (!SLUG_PATTERN[kind].test(value) || value.includes('--') || value.endsWith('-')) {
    return { code: 'slug.invalid', path, message: `${kind} name "${value}" is invalid`, hint: `use ${rule}` };
  }
  return null;
}

/**
 * Derives an environment name from a git branch: "feat/Login_page" becomes
 * "feat-login-page". Names longer than the limit are cut and suffixed with a
 * short hash of the full branch name, so two long branches never collide.
 *
 * @returns The environment name, or null when the branch has no usable character
 */
export function envSlugFromBranch(branch: string): string | null {
  const slug = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) {
    return null;
  }
  if (slug.length <= SLUG_MAX_LENGTH.env) {
    return slug;
  }
  const hash = createHash('sha1').update(branch).digest('hex').slice(0, 4);
  const head = slug.slice(0, SLUG_MAX_LENGTH.env - hash.length - 1).replace(/-+$/, '');
  return `${head}-${hash}`;
}
