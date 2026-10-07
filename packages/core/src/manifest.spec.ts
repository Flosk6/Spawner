import { describe, expect, it } from 'vitest';
import { alwaysOnIssues, parseManifest, publicExposureIssues } from './manifest';

const MINIMAL = `
version: 1
project: blog
exposures:
  - name: web
    service: front
    port: 3000
`;

const FULL = `
version: 1
project: blog
name: api
compose: compose.yaml
sources:
  front:
    repo: git@github.com:acme/blog-front.git
    default_ref: develop
exposures:
  - name: web
    service: front
    port: 3000
    entrypoint: true
  - name: api
    service: api
    port: 8000
    auth: none
seed:
  - service: api
    run: [php, artisan, migrate, --seed, --force]
ttl: 72h
idle: 2h
limits:
  memory: 3g
`;

describe('parseManifest', () => {
  it('applies the defaults of a minimal manifest', () => {
    const { manifest, issues } = parseManifest(MINIMAL);

    expect(issues).toEqual([]);
    expect(manifest).toEqual({
      version: 1,
      project: 'blog',
      name: 'app',
      compose: 'compose.yaml',
      sources: {},
      exposures: [{ name: 'web', service: 'front', port: 3000, entrypoint: true, auth: 'team' }],
      seed: [],
      ttl: undefined,
      idle: undefined,
      upload: { include: [] },
      limits: {},
    });
  });

  it('parses a full manifest, converting durations and sizes', () => {
    const { manifest, issues } = parseManifest(FULL);

    expect(issues).toEqual([]);
    expect(manifest?.sources).toEqual({ front: { repo: 'git@github.com:acme/blog-front.git', defaultRef: 'develop' } });
    expect(manifest?.exposures.map((exposure) => [exposure.name, exposure.entrypoint, exposure.auth])).toEqual([
      ['web', true, 'team'],
      ['api', false, 'none'],
    ]);
    expect(manifest?.ttl).toBe(72 * 3600);
    expect(manifest?.idle).toBe(2 * 3600);
    expect(manifest?.limits.memory).toBe(3 * 1024 ** 3);
  });

  it('keeps "never" as the idle value', () => {
    expect(parseManifest(`${MINIMAL}idle: never\n`).manifest?.idle).toBe('never');
  });

  it.each([
    ['project: Blog', 'project'],
    ['project: my--app', 'project'],
    ['project: a-very-long-project-name', 'project'],
  ])('rejects the project name in %j', (line, path) => {
    const { issues } = parseManifest(MINIMAL.replace('project: blog', line));
    expect(issues).toEqual([expect.objectContaining({ code: 'manifest.invalid', path })]);
  });

  it('rejects unknown keys', () => {
    const { issues } = parseManifest(MINIMAL.replace('port: 3000', 'port: 3000\n    hots: [a]'));
    expect(issues).toEqual([expect.objectContaining({ code: 'manifest.invalid', path: 'exposures[0]' })]);
  });

  it('rejects duplicate exposures and several entrypoints', () => {
    const { issues } = parseManifest(`
version: 1
project: blog
exposures:
  - { name: web, service: front, port: 3000, entrypoint: true }
  - { name: web, service: api, port: 8000, entrypoint: true }
`);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'exposures[1].name', message: 'duplicate exposure "web"' }),
        expect.objectContaining({ path: 'exposures', message: 'only one exposure can be the entrypoint' }),
      ]),
    );
  });

  it('rejects a source named like the repository itself', () => {
    const { issues } = parseManifest(`${MINIMAL}sources:\n  app:\n    repo: git@github.com:acme/x.git\n`);
    expect(issues).toEqual([expect.objectContaining({ path: 'sources.app' })]);
  });

  it('rejects an absolute compose path', () => {
    const { issues } = parseManifest(`${MINIMAL}compose: /etc/compose.yaml\n`);
    expect(issues).toEqual([expect.objectContaining({ path: 'compose' })]);
  });

  it('reports invalid YAML and oversized files', () => {
    expect(parseManifest('version: [1').issues[0].code).toBe('yaml.invalid');
    expect(parseManifest(`#${'x'.repeat(70 * 1024)}`).issues[0].code).toBe('yaml.too_large');
  });

  it('requires at least one exposure', () => {
    const { issues } = parseManifest('version: 1\nproject: blog\nexposures: []\n');
    expect(issues).toEqual([expect.objectContaining({ path: 'exposures', message: 'declare at least one exposure' })]);
  });
});

describe('idle', () => {
  const base = 'version: 1\nproject: blog\nexposures:\n  - { name: web, service: app, port: 3000 }\n';

  it('reads a duration or never, at least 10 minutes', () => {
    expect(parseManifest(`${base}idle: 45m\n`).manifest?.idle).toBe(45 * 60);
    expect(parseManifest(`${base}idle: never\n`).manifest?.idle).toBe('never');
    expect(parseManifest(`${base}idle: 5m\n`).issues).toMatchObject([{ code: 'manifest.invalid', path: 'idle' }]);
  });

  it('keeps an environment awake only where an admin allowed it', () => {
    const { manifest } = parseManifest(`${base}idle: never\n`);
    expect(alwaysOnIssues(manifest!, false)).toMatchObject([{ code: 'manifest.always_on', path: 'idle' }]);
    expect(alwaysOnIssues(manifest!, true)).toEqual([]);
    expect(alwaysOnIssues(parseManifest(base).manifest!, false)).toEqual([]);
  });
});

describe('publicExposureIssues', () => {
  const manifest = {
    exposures: [
      { name: 'web', service: 'app', port: 3000, entrypoint: true, auth: 'team' as const },
      { name: 'hook', service: 'app', port: 4000, entrypoint: false, auth: 'none' as const },
    ],
  };

  it('refuses public exposures unless the project allows them', () => {
    expect(publicExposureIssues(manifest, false)).toEqual([
      expect.objectContaining({ code: 'manifest.public_exposure', path: 'exposures[1].auth' }),
    ]);
    expect(publicExposureIssues(manifest, true)).toEqual([]);
  });
});
