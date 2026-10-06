import { isPlainObject } from '../util';
import type { ComposeContext } from './context';
import type { NormalizedCompose } from './validate';

const LOGGING = { driver: 'local', options: { 'max-size': '10m', 'max-file': '3' } };

/**
 * Builds the compose document Spawner runs: the validated services plus the
 * settings it always imposes (memory, CPU and process limits,
 * no-new-privileges, capped local logs, restart policy) and the labels it
 * uses to find the environment's containers, volumes and network again.
 */
export function renderCompose(model: NormalizedCompose, ctx: ComposeContext): Record<string, unknown> {
  const baseLabels = {
    'dev.spawner.env': ctx.envId,
    'dev.spawner.project': ctx.project,
    'dev.spawner.env-name': ctx.env,
  };

  const services: Record<string, unknown> = {};
  for (const service of model.services) {
    const userLabels = isPlainObject(service.spec.labels) ? (service.spec.labels as Record<string, string>) : {};
    services[service.name] = {
      ...service.spec,
      labels: { ...userLabels, ...baseLabels, 'dev.spawner.service': service.name },
      mem_limit: service.memoryBytes,
      cpus: service.cpus,
      pids_limit: service.pids,
      security_opt: ['no-new-privileges:true'],
      restart: 'unless-stopped',
      logging: LOGGING,
    };
  }

  const document: Record<string, unknown> = { services };

  const volumes = Object.entries(model.volumes);
  if (volumes.length > 0) {
    document.volumes = Object.fromEntries(
      volumes.map(([name, definition]) => [name, withLabels(definition, baseLabels)]),
    );
  }

  document.networks = {
    ...Object.fromEntries(Object.entries(model.networks).map(([name, definition]) => [name, withLabels(definition, baseLabels)])),
    default: withLabels(model.networks.default ?? {}, baseLabels),
  };

  return document;
}

/**
 * Doubles every "$" in string values. Spawner has already interpolated the
 * file; escaping guarantees Compose will not interpolate anything else,
 * including from Spawner's own environment.
 */
export function escapeDollars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.split('$').join('$$');
  }
  if (Array.isArray(value)) {
    return value.map(escapeDollars);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, escapeDollars(item)]));
  }
  return value;
}

function withLabels(definition: Record<string, unknown>, labels: Record<string, string>): Record<string, unknown> {
  const existing = isPlainObject(definition.labels) ? (definition.labels as Record<string, string>) : {};
  return { ...definition, labels: { ...existing, ...labels } };
}
