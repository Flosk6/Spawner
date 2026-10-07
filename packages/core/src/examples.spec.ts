import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { prepareCompose } from './compose/prepare';
import { dockerfileLayerWarnings } from './dockerfile';
import { parseManifest } from './manifest';
import { buildVariables } from './variables';

const EXAMPLES = path.resolve(__dirname, '../../../examples');

const examples = fs
  .readdirSync(EXAMPLES)
  .filter((name) => fs.existsSync(path.join(EXAMPLES, name, '.spawner', 'spawner.yaml')))
  .sort();

describe('examples', () => {
  it('are all checked', () => {
    expect(examples).toEqual(expect.arrayContaining(['laravel-next-mysql', 'node-postgres']));
  });

  it.each(examples)('%s passes the compose policy, and its Dockerfiles share their dependencies', (name) => {
    const root = path.join(EXAMPLES, name);
    const { manifest, issues: manifestIssues } = parseManifest(fs.readFileSync(path.join(root, '.spawner', 'spawner.yaml'), 'utf8'));
    expect(manifestIssues).toEqual([]);

    const sourceRoots = { [manifest!.name]: root };
    const { vars, issues: variableIssues } = buildVariables({
      project: manifest!.project,
      env: 'feat-login',
      domain: 'preview.example.com',
      scheme: 'https',
      exposures: manifest!.exposures,
      sourceRoots,
    });
    expect(variableIssues).toEqual([]);

    const composeDir = path.join(root, '.spawner');
    const prepared = prepareCompose(fs.readFileSync(path.join(composeDir, manifest!.compose), 'utf8'), vars, {
      project: manifest!.project,
      env: 'feat-login',
      envId: 'env_example',
      composeDir,
      sourceRoots,
      exposures: manifest!.exposures,
      seedServices: manifest!.seed.map((step) => step.service),
    });
    expect(prepared.issues).toEqual([]);

    const services = (prepared.document?.services ?? {}) as Record<string, { build?: { context: string; dockerfile?: string } }>;
    const builds = Object.values(services).flatMap((service) => (service.build ? [service.build] : []));
    expect(builds.length).toBeGreaterThan(0);
    for (const build of builds) {
      const dockerfile = path.resolve(build.context, build.dockerfile ?? 'Dockerfile');
      expect(dockerfileLayerWarnings(fs.readFileSync(dockerfile, 'utf8')), dockerfile).toEqual([]);
    }
  });
});
