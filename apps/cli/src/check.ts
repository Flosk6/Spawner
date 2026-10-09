import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  alwaysOnIssues,
  buildVariables,
  defaultRealpath,
  dockerfileLayerWarnings,
  isInside,
  parseManifest,
  prepareCompose,
  publicExposureIssues,
  sourceRepoIssues,
  type ComposeLimits,
  type Issue,
  type Manifest,
} from "@spawner/core";
import type { ServerInfo } from "@spawner/types";
import type { Workspace } from "./workspace";

/** Where the sources taken from git would be: they are not on this machine. */
const REMOTE_ROOT = path.join(os.tmpdir(), "spawner-remote-source");

export interface LocalCheck {
  manifest?: Manifest;
  issues: Issue[];
  /** Services of the compose file. */
  services: string[];
  /** Dockerfiles that keep environments from sharing their dependencies: "app: the whole code is copied..." */
  warnings?: string[];
}

/**
 * Validates spawner.yaml and the compose file on this machine with the code
 * and the limits the server applies, so that a refused file fails in a
 * second, before anything is sent. Paths inside the sources taken from git
 * cannot be checked here; the server checks them.
 *
 * @param uploads - Local directory of each source sent from a worktree
 * @param project - What the server says of the project: whether it allows
 *   public URLs and environments that never sleep, the names of its
 *   variables (their values stay there), and the repositories its sources
 *   may come from (null from a server that does not say)
 */
export function checkProject(
  workspace: Workspace,
  env: string,
  info: ServerInfo,
  uploads: Record<string, string>,
  project: { allowPublic: boolean; allowAlwaysOn: boolean; variables: string[]; sourceRepos: string[] | null } = {
    allowPublic: true,
    allowAlwaysOn: true,
    variables: [],
    sourceRepos: null,
  },
): LocalCheck {
  const parsed = parseManifest(workspace.manifestText);
  if (!parsed.manifest) {
    return { issues: parsed.issues.map((issue) => ({ ...issue, path: issue.path ? `spawner.yaml: ${issue.path}` : "spawner.yaml" })), services: [] };
  }
  const manifest = parsed.manifest;
  const permissionIssues = [
    ...publicExposureIssues(manifest, project.allowPublic),
    ...alwaysOnIssues(manifest, project.allowAlwaysOn),
    ...(project.sourceRepos ? sourceRepoIssues(manifest, project.sourceRepos) : []),
  ];
  if (permissionIssues.length > 0) {
    return { manifest, issues: permissionIssues.map((issue) => ({ ...issue, path: `spawner.yaml: ${issue.path}` })), services: [] };
  }

  const sourceRoots: Record<string, string> = { [manifest.name]: workspace.projectRoot };
  for (const name of Object.keys(manifest.sources)) {
    sourceRoots[name] = uploads[name] ?? path.join(REMOTE_ROOT, name);
  }
  const realpath = (target: string) => (isInside(target, REMOTE_ROOT) ? target : defaultRealpath(target));

  const { vars, issues: variableIssues } = buildVariables({
    project: manifest.project,
    env,
    domain: info.previewDomain,
    scheme: info.scheme,
    exposures: manifest.exposures,
    sourceRoots,
    projectVariables: Object.fromEntries(project.variables.map((name) => [name, "value-set-on-the-server"])),
  });
  if (variableIssues.length > 0) {
    return { manifest, issues: variableIssues, services: [] };
  }

  const composePath = path.resolve(workspace.projectRoot, ".spawner", manifest.compose);
  const real = defaultRealpath(composePath);
  if (!real || !isInside(real, workspace.projectRoot)) {
    return {
      manifest,
      issues: [
        {
          code: "compose.path_not_found",
          path: "spawner.yaml: compose",
          message: real ? `${manifest.compose} resolves outside the project` : `${path.relative(workspace.projectRoot, composePath)} does not exist`,
        },
      ],
      services: [],
    };
  }

  const { envMemoryMaxBytes, ...composeLimits } = info.limits.compose;
  const limits: ComposeLimits = {
    ...composeLimits,
    envMemoryBytes: Math.min(manifest.limits.memory ?? composeLimits.envMemoryBytes, envMemoryMaxBytes),
  };
  const prepared = prepareCompose(fs.readFileSync(real, "utf8"), vars, {
    project: manifest.project,
    env,
    envId: "local-check",
    composeDir: path.dirname(real),
    sourceRoots,
    exposures: manifest.exposures,
    seedServices: manifest.seed.map((step) => step.service),
    limits,
    realpath,
  });
  return { manifest, issues: prepared.issues, services: prepared.services, warnings: layerWarnings(prepared.document ?? {}) };
}

/** A Dockerfile larger than this is not read: it would not be one. */
const DOCKERFILE_MAX_BYTES = 1024 * 1024;

/**
 * Looks at the Dockerfiles of this machine's sources for a copy of the whole
 * code before the dependencies are installed. Only regular files of 1 MiB
 * at most are read: a FIFO or a device named Dockerfile would hang the CLI.
 */
function layerWarnings(document: Record<string, unknown>): string[] {
  const services = (document.services ?? {}) as Record<string, { build?: { context?: string; dockerfile?: string } }>;
  const warnings: string[] = [];
  for (const [name, service] of Object.entries(services)) {
    const context = service.build?.context;
    if (!context || isInside(context, REMOTE_ROOT)) {
      continue;
    }
    let text: string;
    try {
      const dockerfile = service.build?.dockerfile ?? path.join(context, "Dockerfile");
      const stat = fs.statSync(dockerfile);
      if (!stat.isFile() || stat.size > DOCKERFILE_MAX_BYTES) {
        continue;
      }
      text = fs.readFileSync(dockerfile, "utf8");
    } catch {
      continue;
    }
    for (const warning of dockerfileLayerWarnings(text)) {
      warnings.push(`${name}: ${warning.message}. ${warning.hint}`);
    }
  }
  return warnings;
}
