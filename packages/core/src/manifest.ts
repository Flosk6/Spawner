import { parse } from 'yaml';
import { z } from 'zod';
import type { Issue } from './errors';
import { slugIssue, type SlugKind } from './slug';
import { parseDuration, parseSize } from './units';
import { keyPath } from './util';

export const MANIFEST_PATH = '.spawner/spawner.yaml';
const MAX_MANIFEST_BYTES = 64 * 1024;
/** Shortest idle time before an environment goes to sleep. */
export const MIN_IDLE_SECONDS = 10 * 60;

export interface ManifestSource {
  repo: string;
  defaultRef: string;
}

export interface ManifestExposure {
  name: string;
  service: string;
  port: number;
  entrypoint: boolean;
  auth: 'team' | 'none';
}

export interface SeedStep {
  service: string;
  run: string[];
}

/**
 * The validated content of .spawner/spawner.yaml. Durations are in seconds
 * and sizes in bytes.
 */
export interface Manifest {
  version: 1;
  project: string;
  name: string;
  compose: string;
  sources: Record<string, ManifestSource>;
  exposures: ManifestExposure[];
  seed: SeedStep[];
  ttl?: number;
  idle?: number | 'never';
  upload: { include: string[] };
  limits: { memory?: number };
}

const slug = (kind: SlugKind) =>
  z.string().superRefine((value, ctx) => {
    const issue = slugIssue(kind, value, '');
    if (issue) {
      ctx.addIssue({ code: 'custom', message: issue.hint ? `${issue.message} (${issue.hint})` : issue.message });
    }
  });

const duration = z
  .string()
  .refine((value) => parseDuration(value) !== null, 'expected a duration such as "30m", "72h" or "14d"')
  .transform((value) => parseDuration(value) as number);

const size = z
  .union([z.string(), z.number()])
  .refine((value) => parseSize(value) !== null, 'expected a size such as "512m" or "2g"')
  .transform((value) => parseSize(value) as number);

const manifestSchema = z
  .strictObject({
    version: z.literal(1),
    project: slug('project'),
    name: slug('source').default('app'),
    compose: z
      .string()
      .min(1)
      .refine((value) => !value.startsWith('/') && !value.startsWith('~'), 'compose must be a path relative to .spawner/')
      .default('compose.yaml'),
    sources: z
      .record(
        slug('source'),
        z.strictObject({
          repo: z.string().min(1),
          default_ref: z.string().min(1).default('main'),
        }),
      )
      .default({}),
    exposures: z
      .array(
        z.strictObject({
          name: slug('exposure'),
          service: z.string().min(1),
          port: z.number().int().min(1).max(65535),
          entrypoint: z.boolean().optional(),
          auth: z.enum(['team', 'none']).default('team'),
        }),
      )
      .min(1, 'declare at least one exposure')
      .max(10, 'at most 10 exposures'),
    seed: z
      .array(
        z.strictObject({
          service: z.string().min(1),
          run: z.array(z.string()).min(1),
        }),
      )
      .default([]),
    ttl: duration.optional(),
    idle: z
      .union([z.literal('never'), duration.refine((seconds) => seconds >= MIN_IDLE_SECONDS, 'idle must be at least 10m (or never)')])
      .optional(),
    upload: z.strictObject({ include: z.array(z.string()).default([]) }).default({ include: [] }),
    limits: z.strictObject({ memory: size.optional() }).default({}),
  })
  .superRefine((manifest, ctx) => {
    const names = new Set<string>();
    manifest.exposures.forEach((exposure, index) => {
      if (names.has(exposure.name)) {
        ctx.addIssue({ code: 'custom', path: ['exposures', index, 'name'], message: `duplicate exposure "${exposure.name}"` });
      }
      names.add(exposure.name);
    });
    const entrypoints = manifest.exposures.filter((exposure) => exposure.entrypoint === true);
    if (entrypoints.length > 1) {
      ctx.addIssue({ code: 'custom', path: ['exposures'], message: 'only one exposure can be the entrypoint' });
    }
    if (Object.prototype.hasOwnProperty.call(manifest.sources, manifest.name)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sources', manifest.name],
        message: `"${manifest.name}" is the name of this repository's own source`,
      });
    }
  });

/**
 * Parses and validates .spawner/spawner.yaml. When no exposure is flagged as
 * the entrypoint, the first one is.
 *
 * @param text - Raw YAML content of the manifest
 * @returns The manifest, or the list of issues found
 */
export function parseManifest(text: string): { manifest?: Manifest; issues: Issue[] } {
  if (Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) {
    return { issues: [{ code: 'yaml.too_large', path: '', message: 'spawner.yaml is larger than 64 KiB' }] };
  }

  let raw: unknown;
  try {
    raw = parse(text, { maxAliasCount: 50, uniqueKeys: true });
  } catch (error) {
    return { issues: [{ code: 'yaml.invalid', path: '', message: (error as Error).message }] };
  }

  const result = manifestSchema.safeParse(raw ?? {});
  if (!result.success) {
    return {
      issues: result.error.issues.map((issue) => ({
        code: 'manifest.invalid' as const,
        path: issue.path.reduce<string>((acc, part) => keyPath(acc, part as string | number), ''),
        message: issue.message,
      })),
    };
  }

  const data = result.data;
  const hasEntrypoint = data.exposures.some((exposure) => exposure.entrypoint === true);
  const manifest: Manifest = {
    version: 1,
    project: data.project,
    name: data.name,
    compose: data.compose,
    sources: Object.fromEntries(
      Object.entries(data.sources).map(([name, source]) => [name, { repo: source.repo, defaultRef: source.default_ref }]),
    ),
    exposures: data.exposures.map((exposure, index) => ({
      name: exposure.name,
      service: exposure.service,
      port: exposure.port,
      entrypoint: hasEntrypoint ? exposure.entrypoint === true : index === 0,
      auth: exposure.auth,
    })),
    seed: data.seed,
    ttl: data.ttl,
    idle: data.idle,
    upload: data.upload,
    limits: data.limits,
  };
  return { manifest, issues: [] };
}

/**
 * An environment that never sleeps (idle: never) in a project whose admins
 * did not allow it: by default, idle environments sleep to free memory.
 */
export function alwaysOnIssues(manifest: Pick<Manifest, 'idle'>, allowAlwaysOn: boolean): Issue[] {
  if (allowAlwaysOn || manifest.idle !== 'never') {
    return [];
  }
  return [
    {
      code: 'manifest.always_on',
      path: 'idle',
      message: 'idle: never keeps the environment awake, which this project does not allow',
      hint: 'remove idle: never, or ask an admin to allow environments that never sleep in the project settings',
    },
  ];
}

/**
 * Exposures that would be public (auth: none) in a project whose admins did
 * not allow public URLs: by default, every preview needs a login.
 */
export function publicExposureIssues(manifest: Pick<Manifest, 'exposures'>, allowPublic: boolean): Issue[] {
  if (allowPublic) {
    return [];
  }
  return manifest.exposures.flatMap((exposure, index) =>
    exposure.auth === 'none'
      ? [
          {
            code: 'manifest.public_exposure' as const,
            path: keyPath(keyPath('exposures', index), 'auth'),
            message: `exposure "${exposure.name}" is public (auth: none), which this project does not allow`,
            hint: 'remove auth: none, or ask an admin to allow public URLs in the project settings',
          },
        ]
      : [],
  );
}
