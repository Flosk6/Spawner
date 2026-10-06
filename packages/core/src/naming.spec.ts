import { describe, expect, it } from 'vitest';
import { exposureHostname, variableSuffix } from './hostnames';
import { envSlugFromBranch, SLUG_MAX_LENGTH, slugIssue } from './slug';
import { formatSize, parseDuration, parseSize } from './units';
import { buildVariables } from './variables';

describe('slugIssue', () => {
  it.each([
    ['project', 'blog'],
    ['project', 'my-app2'],
    ['env', 'feat-login'],
    ['env', '123-hotfix'],
    ['exposure', 'api'],
  ] as const)('accepts the %s name %s', (kind, value) => {
    expect(slugIssue(kind, value, 'p')).toBeNull();
  });

  it.each([
    ['project', ''],
    ['project', 'Blog'],
    ['project', '1app'],
    ['project', 'my--app'],
    ['project', 'app-'],
    ['project', 'a'.repeat(21)],
    ['env', 'feat/login'],
    ['env', 'a'.repeat(30)],
    ['exposure', 'api_v2'],
  ] as const)('rejects the %s name %j', (kind, value) => {
    expect(slugIssue(kind, value, 'p')).toMatchObject({ code: 'slug.invalid', path: 'p' });
  });
});

describe('envSlugFromBranch', () => {
  it.each([
    ['feat/login', 'feat-login'],
    ['Feature/Login_Page', 'feature-login-page'],
    ['fix//double--dash', 'fix-double-dash'],
    ['-leading-and-trailing-', 'leading-and-trailing'],
  ])('turns %s into %s', (branch, slug) => {
    expect(envSlugFromBranch(branch)).toBe(slug);
  });

  it('returns null when nothing usable is left', () => {
    expect(envSlugFromBranch('///')).toBeNull();
  });

  it('cuts long branches and keeps them distinct with a hash', () => {
    const a = envSlugFromBranch('feature/a-very-long-branch-name-for-the-login-page');
    const b = envSlugFromBranch('feature/a-very-long-branch-name-for-the-signup-page');

    expect(a?.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH.env);
    expect(a).not.toBe(b);
    expect(slugIssue('env', a, 'p')).toBeNull();
    expect(envSlugFromBranch('feature/a-very-long-branch-name-for-the-login-page')).toBe(a);
  });
});

describe('exposureHostname', () => {
  it('gives the entrypoint a short host and the others a prefixed one', () => {
    const base = { project: 'blog', env: 'feat-login', domain: 'preview.example.com' };
    expect(exposureHostname({ ...base, exposure: 'web', entrypoint: true })).toBe('feat-login--blog.preview.example.com');
    expect(exposureHostname({ ...base, exposure: 'api', entrypoint: false })).toBe('api--feat-login--blog.preview.example.com');
  });

  it('stays within a DNS label with the longest names', () => {
    const label = exposureHostname({
      project: 'p'.repeat(SLUG_MAX_LENGTH.project),
      env: 'e'.repeat(SLUG_MAX_LENGTH.env),
      exposure: 'x'.repeat(SLUG_MAX_LENGTH.exposure),
      entrypoint: false,
      domain: 'd',
    }).split('.')[0];
    expect(label.length).toBeLessThanOrEqual(63);
  });

  it('builds variable suffixes', () => {
    expect(variableSuffix('front-end')).toBe('FRONT_END');
  });
});

describe('buildVariables', () => {
  it('exposes URLs, hosts and source paths', () => {
    const { vars, hosts, issues } = buildVariables({
      project: 'blog',
      env: 'feat',
      domain: 'preview.test',
      scheme: 'http',
      exposures: [
        { name: 'web', entrypoint: true },
        { name: 'api', entrypoint: false },
      ],
      sourceRoots: { app: '/srv/app', 'front-end': '/srv/front' },
      projectVariables: { STRIPE_KEY: 'sk_test' },
    });

    expect(issues).toEqual([]);
    expect(hosts).toEqual({ web: 'feat--blog.preview.test', api: 'api--feat--blog.preview.test' });
    expect(vars).toEqual({
      STRIPE_KEY: 'sk_test',
      SPAWNER_PROJECT: 'blog',
      SPAWNER_ENV: 'feat',
      SPAWNER_URL: 'http://feat--blog.preview.test',
      SPAWNER_URL_WEB: 'http://feat--blog.preview.test',
      SPAWNER_HOST_WEB: 'feat--blog.preview.test',
      SPAWNER_URL_API: 'http://api--feat--blog.preview.test',
      SPAWNER_HOST_API: 'api--feat--blog.preview.test',
      SPAWNER_SRC_APP: '/srv/app',
      SPAWNER_SRC_FRONT_END: '/srv/front',
    });
  });

  it('refuses project variables that would shadow Spawner variables', () => {
    const { vars, issues } = buildVariables({
      project: 'blog',
      env: 'feat',
      domain: 'd',
      scheme: 'https',
      exposures: [],
      sourceRoots: {},
      projectVariables: { SPAWNER_URL: 'https://evil', 'bad-name': 'x' },
    });
    expect(issues.map((issue) => issue.path)).toEqual(['variables.SPAWNER_URL', 'variables.bad-name']);
    expect(vars.SPAWNER_URL).toBeUndefined();
  });
});

describe('units', () => {
  it.each([
    ['90s', 90],
    ['1m30s', 90],
    ['72h', 259200],
    ['14d', 1209600],
    ['1.5s', 1.5],
    ['500ms', 0.5],
  ])('parses the duration %s', (value, seconds) => {
    expect(parseDuration(value)).toBe(seconds);
  });

  it.each(['', 'abc', '10', '1h ', '-5s'])('rejects the duration %j', (value) => {
    expect(parseDuration(value)).toBeNull();
  });

  it.each([
    ['512m', 512 * 1024 ** 2],
    ['1g', 1024 ** 3],
    ['1.5gb', 1.5 * 1024 ** 3],
    ['100', 100],
    [2048, 2048],
  ])('parses the size %j', (value, bytes) => {
    expect(parseSize(value)).toBe(bytes);
  });

  it.each(['10x', 'm', '', '-1g'])('rejects the size %j', (value) => {
    expect(parseSize(value)).toBeNull();
  });

  it('formats sizes for messages', () => {
    expect(formatSize(2 * 1024 ** 3)).toBe('2 GiB');
    expect(formatSize(768 * 1024 ** 2)).toBe('768 MiB');
  });
});
