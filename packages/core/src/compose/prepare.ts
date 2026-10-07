import { parse, stringify } from 'yaml';
import type { Issue } from '../errors';
import { interpolateTree } from '../interpolate';
import { isPlainObject } from '../util';
import type { ComposeContext } from './context';
import { escapeDollars, renderCompose } from './render';
import { validateCompose } from './validate';

const MAX_COMPOSE_BYTES = 1024 * 1024;

export interface PreparedCompose {
  issues: Issue[];
  document?: Record<string, unknown>;
  yaml?: string;
  services: string[];
  bindSources: string[];
  /**
   * Sources the environment still needs once built: mounted into a service,
   * or holding an env_file. The others may be removed after the build.
   */
  runtimeSources: string[];
  servicesMountingSources: string[];
}

/**
 * Turns a user compose file into the file Spawner runs, in this order:
 * parse (size and alias limits), interpolate with Spawner's variables only,
 * validate against the policy, render the enforced settings, then escape every
 * "$" so Compose interpolates nothing more. Nothing is rendered when any
 * issue is found.
 *
 * @param text - Raw compose file
 * @param vars - Variables available to the file (see buildVariables)
 * @param ctx - Environment context: sources, exposures, limits
 * @returns The rendered YAML and model, or the issues found
 */
export function prepareCompose(text: string, vars: Record<string, string>, ctx: ComposeContext): PreparedCompose {
  const empty = { services: [], bindSources: [], runtimeSources: [], servicesMountingSources: [] };

  if (Buffer.byteLength(text, 'utf8') > MAX_COMPOSE_BYTES) {
    return { ...empty, issues: [{ code: 'yaml.too_large', path: '', message: 'the compose file is larger than 1 MiB' }] };
  }

  let raw: unknown;
  try {
    raw = parse(text, { maxAliasCount: 100, merge: true, uniqueKeys: true });
  } catch (error) {
    return { ...empty, issues: [{ code: 'yaml.invalid', path: '', message: (error as Error).message }] };
  }
  if (!isPlainObject(raw)) {
    return { ...empty, issues: [{ code: 'compose.invalid', path: '', message: 'the compose file must be a mapping' }] };
  }

  const issues: Issue[] = [];
  const interpolated = interpolateTree(raw, vars, '', issues) as Record<string, unknown>;
  if (issues.length > 0) {
    return { ...empty, issues };
  }

  const model = validateCompose(interpolated, ctx, issues);
  if (issues.length > 0) {
    return { ...empty, issues };
  }

  const document = renderCompose(model, ctx);
  return {
    issues,
    document,
    yaml: stringify(escapeDollars(document), { lineWidth: 0 }),
    services: model.services.map((service) => service.name),
    bindSources: model.bindSources,
    runtimeSources: [...new Set([...model.bindSources, ...model.envFileSources])],
    servicesMountingSources: model.servicesMountingSources,
  };
}
