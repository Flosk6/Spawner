import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildVariables,
  defaultRealpath,
  isInside,
  parseManifest,
  prepareCompose,
  publicExposureIssues,
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
}

/**
 * Validates spawner.yaml and the compose file on this machine with the code
 * and the limits the server applies, so that a refused file fails in a
 * second, before anything is sent. Paths inside the sources taken from git
 * cannot be checked here; the server checks them.
 *
 * @param uploads - Local directory of each source sent from a worktree
 * @param project - What the server says of the project: whether it allows
 *   public URLs, and the names of its variables (their values stay there)
 */
export function checkProject(
  workspace: Workspace,
  env: string,
  info: ServerInfo,
  uploads: Record<string, string>,
  project: { allowPublic: boolean; variables: string[] } = { allowPublic: true, variables: [] },
): LocalCheck {
  const parsed = parseManifest(workspace.manifestText);
  if (!parsed.manifest) {
    return { issues: parsed.issues.map((issue) => ({ ...issue, path: issue.path ? `spawner.yaml: ${issue.path}` : "spawner.yaml" })), services: [] };
  }
  const manifest = parsed.manifest;
  const publicIssues = publicExposureIssues(manifest, project.allowPublic);
  if (publicIssues.length > 0) {
    return { manifest, issues: publicIssues.map((issue) => ({ ...issue, path: `spawner.yaml: ${issue.path}` })), services: [] };
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
  return { manifest, issues: prepared.issues, services: prepared.services };
}
