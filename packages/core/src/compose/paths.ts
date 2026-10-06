import * as fs from 'fs';
import * as path from 'path';
import type { Issue } from '../errors';

/**
 * Resolves symlinks; returns null when the path does not exist.
 */
export function defaultRealpath(target: string): string | null {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return null;
  }
}

export function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Checks that the paths a compose file uses (build contexts, Dockerfiles,
 * env files, bind mounts) stay inside the environment sources once symlinks
 * are resolved, so a file can never reach the host or Spawner's own data.
 */
export class SourceResolver {
  private readonly roots: { name: string; lexical: string; real: string }[];

  constructor(
    sourceRoots: Record<string, string>,
    private readonly realpath: (target: string) => string | null,
  ) {
    this.roots = Object.entries(sourceRoots).map(([name, root]) => ({
      name,
      lexical: path.resolve(root),
      real: realpath(root) ?? path.resolve(root),
    }));
  }

  /**
   * Resolves a path written in the compose file.
   *
   * @param target - Path as written (relative to base, or absolute)
   * @param base - Directory relative paths start from
   * @param what - Human name of the path, used in messages ("bind mount source")
   * @param issuePath - Key path of the value, used in issues
   * @param issues - Collector for problems found
   * @param mustExist - When false, a missing path inside the sources is accepted
   * @returns The resolved absolute path and the source it belongs to, or null
   */
  resolve(
    target: string,
    base: string,
    what: string,
    issuePath: string,
    issues: Issue[],
    mustExist = true,
  ): { path: string; source: string } | null {
    if (target.startsWith('~')) {
      issues.push({
        code: 'compose.path_outside_sources',
        path: issuePath,
        message: `${what} "${target}" points to a home directory`,
        hint: 'use a path inside the repository',
      });
      return null;
    }

    const candidate = path.isAbsolute(target) ? path.normalize(target) : path.resolve(base, target);
    const real = this.realpath(candidate);

    if (real === null) {
      const lexicalRoot = this.roots.find((root) => isInside(candidate, root.lexical) || isInside(candidate, root.real));
      if (!lexicalRoot) {
        issues.push(this.outside(what, target, issuePath));
        return null;
      }
      if (mustExist) {
        issues.push({
          code: 'compose.path_not_found',
          path: issuePath,
          message: `${what} "${target}" does not exist in source "${lexicalRoot.name}"`,
        });
        return null;
      }
      return { path: candidate, source: lexicalRoot.name };
    }

    const root = this.roots.find((entry) => isInside(real, entry.real));
    if (!root) {
      issues.push(this.outside(what, target, issuePath));
      return null;
    }
    return { path: real, source: root.name };
  }

  private outside(what: string, target: string, issuePath: string): Issue {
    return {
      code: 'compose.path_outside_sources',
      path: issuePath,
      message: `${what} "${target}" resolves outside the environment sources`,
      hint: 'paths must stay inside the repositories declared in spawner.yaml',
    };
  }
}
