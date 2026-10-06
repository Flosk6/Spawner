import type { Issue } from './errors';
import { exposureHostname, variableSuffix } from './hostnames';
import { keyPath } from './util';

const PROJECT_VARIABLE = /^[A-Z_][A-Z0-9_]*$/;

export interface VariablesInput {
  project: string;
  env: string;
  domain: string;
  scheme: 'http' | 'https';
  exposures: { name: string; entrypoint: boolean }[];
  sourceRoots: Record<string, string>;
  projectVariables?: Record<string, string>;
}

/**
 * Builds the only variables a compose file can reference: SPAWNER_PROJECT,
 * SPAWNER_ENV, SPAWNER_URL, SPAWNER_URL_<EXPOSURE>, SPAWNER_HOST_<EXPOSURE>,
 * SPAWNER_SRC_<SOURCE>, plus the variables an admin set on the project.
 *
 * @returns The variables, the hostname of each exposure, and naming issues
 */
export function buildVariables(input: VariablesInput): {
  vars: Record<string, string>;
  hosts: Record<string, string>;
  issues: Issue[];
} {
  const issues: Issue[] = [];
  const vars: Record<string, string> = {};
  const hosts: Record<string, string> = {};

  for (const [name, value] of Object.entries(input.projectVariables ?? {})) {
    if (!PROJECT_VARIABLE.test(name) || name.startsWith('SPAWNER_')) {
      issues.push({
        code: 'variables.invalid',
        path: keyPath('variables', name),
        message: `invalid project variable name "${name}"`,
        hint: 'use uppercase letters, digits and underscores, not starting with SPAWNER_',
      });
      continue;
    }
    vars[name] = value;
  }

  vars.SPAWNER_PROJECT = input.project;
  vars.SPAWNER_ENV = input.env;

  for (const exposure of input.exposures) {
    const host = exposureHostname({
      project: input.project,
      env: input.env,
      exposure: exposure.name,
      entrypoint: exposure.entrypoint,
      domain: input.domain,
    });
    hosts[exposure.name] = host;
    const url = `${input.scheme}://${host}`;
    vars[`SPAWNER_HOST_${variableSuffix(exposure.name)}`] = host;
    vars[`SPAWNER_URL_${variableSuffix(exposure.name)}`] = url;
    if (exposure.entrypoint) {
      vars.SPAWNER_URL = url;
    }
  }

  for (const [name, root] of Object.entries(input.sourceRoots)) {
    vars[`SPAWNER_SRC_${variableSuffix(name)}`] = root;
  }

  return { vars, hosts, issues };
}
