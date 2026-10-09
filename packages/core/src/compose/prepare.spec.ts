import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildVariables } from '../variables';
import { composeProjectName, type ComposeContext } from './context';
import { prepareCompose } from './prepare';

const FIXTURES = path.resolve(__dirname, '../../test/fixtures/compose');
const MiB = 1024 ** 2;

let root: string;
let app: string;
let ctx: ComposeContext;
let vars: Record<string, string>;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'spawner-core-'));
  app = path.join(root, 'src', 'app');
  const front = path.join(root, 'src', 'front');
  for (const dir of [path.join(app, '.spawner'), path.join(app, 'docker'), front, path.join(root, 'outside')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(app, 'Dockerfile'), 'FROM alpine\n');
  fs.writeFileSync(path.join(app, '.env.preview'), 'A=b\n');
  fs.writeFileSync(path.join(app, 'docker', 'nginx.conf'), 'server {}\n');
  fs.writeFileSync(path.join(front, 'Dockerfile'), 'FROM node:22\n');
  fs.writeFileSync(path.join(root, 'outside', 'secret.txt'), 'secret\n');
  fs.symlinkSync(path.join(root, 'outside'), path.join(app, 'escape'));
  fs.symlinkSync('/', path.join(app, 'rootlink'));

  const sourceRoots = { app, front };
  ctx = {
    project: 'blog',
    env: 'feat-login',
    envId: 'env_test',
    composeDir: path.join(app, '.spawner'),
    sourceRoots,
    exposures: [
      { name: 'web', service: 'front' },
      { name: 'api', service: 'api' },
    ],
    seedServices: ['api'],
  };
  vars = buildVariables({
    project: 'blog',
    env: 'feat-login',
    domain: 'preview.test',
    scheme: 'https',
    exposures: [
      { name: 'web', entrypoint: true },
      { name: 'api', entrypoint: false },
    ],
    sourceRoots,
  }).vars;
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function fixture(kind: 'allowed' | 'forbidden', name: string): string {
  return fs.readFileSync(path.join(FIXTURES, kind, name), 'utf8');
}

function render(name: string) {
  const result = prepareCompose(fixture('allowed', name), vars, ctx);
  expect(result.issues).toEqual([]);
  return result as Required<typeof result>;
}

function service(document: Record<string, unknown>, name: string): Record<string, any> {
  return (document.services as Record<string, Record<string, any>>)[name];
}

describe('forbidden fixtures', () => {
  const files = fs.readdirSync(path.join(FIXTURES, 'forbidden')).filter((file) => file.endsWith('.yaml')).sort();

  it.each(files)('%s is rejected with the expected issue', (file) => {
    const text = fixture('forbidden', file);
    const expected = [...text.matchAll(/^# expect: (\S+)(?: (.+))?$/gm)].map((match) => ({ code: match[1], path: match[2] ?? '' }));
    expect(expected.length).toBeGreaterThan(0);

    const result = prepareCompose(text, vars, ctx);

    expect(result.yaml).toBeUndefined();
    for (const issue of expected) {
      expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining(issue)]));
    }
  });
});

describe('allowed fixtures', () => {
  const files = fs.readdirSync(path.join(FIXTURES, 'allowed')).filter((file) => file.endsWith('.yaml')).sort();

  it.each(files)('%s is rendered without issue', (file) => {
    const result = prepareCompose(fixture('allowed', file), vars, ctx);
    expect(result.issues).toEqual([]);
    expect(result.yaml).toContain('services:');
  });
});

describe('rendering', () => {
  it('enforces restart, logging, security options and labels, whatever the file says', () => {
    const { document } = render('laravel-next-mysql.yaml');
    const api = service(document, 'api');

    expect(api.restart).toBe('unless-stopped');
    expect(api.logging).toEqual({ driver: 'local', options: { 'max-size': '10m', 'max-file': '3' } });
    expect(api.security_opt).toEqual(['no-new-privileges:true']);
    expect(api.labels).toMatchObject({
      'dev.spawner.env': 'env_test',
      'dev.spawner.project': 'blog',
      'dev.spawner.service': 'api',
    });
    expect((document.networks as any).default.labels['dev.spawner.env']).toBe('env_test');
    expect((document.volumes as any)['db-data'].labels['dev.spawner.env']).toBe('env_test');
    expect(api.build.labels).toMatchObject({ 'dev.spawner.env': 'env_test', 'dev.spawner.service': 'api' });
  });

  it('drops the image name of built services so builds never overwrite another tag', () => {
    const api = service(render('laravel-next-mysql.yaml').document, 'api');
    expect(api.image).toBeUndefined();
    expect(api.build.context).toBe(fs.realpathSync(app));
  });

  it('keeps the sources a built environment needs: mounted ones and those holding an env_file', () => {
    expect(render('laravel-next-mysql.yaml').runtimeSources).not.toContain('front');
  });

  it('injects the exposure URLs', () => {
    const { document } = render('laravel-next-mysql.yaml');
    expect(service(document, 'api').environment).toMatchObject({
      APP_URL: 'https://api--feat-login--blog.preview.test',
      FRONTEND_URL: 'https://feat-login--blog.preview.test',
    });
    expect(service(document, 'front').build.args.NEXT_PUBLIC_API_URL).toBe('https://api--feat-login--blog.preview.test');
  });

  it('makes every path absolute and reports the sources used by bind mounts', () => {
    const result = render('volumes-long-syntax.yaml');
    const api = service(result.document, 'api');

    expect(result.bindSources).toEqual(['app']);
    expect(result.runtimeSources).toEqual(['app']);
    expect(result.servicesMountingSources).toEqual(['api']);
    expect(api.volumes[2].source).toBe(fs.realpathSync(path.join(app, 'docker', 'nginx.conf')));
    expect(api.volumes[3]).toBe(`${fs.realpathSync(path.join(app, 'docker'))}:/docker:ro`);
    expect(api.volumes[4]).toBe('/var/lib/anonymous');
    expect(api.env_file[0]).toBe(fs.realpathSync(path.join(app, '.env.preview')));
    expect(api.env_file[1]).toEqual({ path: path.resolve(ctx.composeDir, '../.env.optional'), required: false });
  });

  it('escapes every $ so Compose interpolates nothing more', () => {
    const result = render('interpolation-defaults.yaml');
    const api = service(result.document, 'api');

    expect(api.environment).toEqual({
      PORT: '3000',
      LITERAL: '$HOME',
      URL: 'https://api--feat-login--blog.preview.test',
      NESTED: 'feat-login-fallback',
    });
    expect(result.yaml).toContain('LITERAL: $$HOME');
    expect(result.yaml).toContain('echo $${PORT}');
  });

  it('shares the remaining memory budget between services without limits', () => {
    const { document } = render('resources.yaml');

    expect(service(document, 'api')).toMatchObject({ mem_limit: 768 * MiB, cpus: 1.5, pids_limit: 256 });
    expect(service(document, 'api').deploy).toBeUndefined();
    expect(service(document, 'front').mem_limit).toBe(256 * MiB);
    expect(service(document, 'worker')).toMatchObject({ mem_limit: 512 * MiB, cpus: 0.83, pids_limit: 512 });
    expect(service(document, 'cache').mem_limit).toBe(512 * MiB);
  });

  it('shares the CPUs and processes of the environment, and drops raw sockets', () => {
    const many = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`s${index}`, { image: 'alpine', command: 'sleep infinity' }]));
    const { document, issues } = prepareCompose(JSON.stringify({ services: { ...many, s0: { image: 'alpine', cap_drop: ['ALL'] } } }), vars, { ...ctx, exposures: [], seedServices: [] });
    expect(issues).toEqual([]);
    expect(service(document!, 's1')).toMatchObject({ cpus: 0.4, pids_limit: 409, cap_drop: ['NET_RAW'] });
    expect(service(document!, 's0').cap_drop).toEqual(['ALL', 'NET_RAW']);
  });

  it('merges YAML anchors and drops extension fields', () => {
    const { document } = render('anchors-and-extensions.yaml');

    expect(document['x-common']).toBeUndefined();
    expect(service(document, 'api').environment).toEqual({ TZ: 'Europe/Paris' });
    expect(service(document, 'front').restart).toBe('unless-stopped');
  });
});

describe('names on the environment network', () => {
  const base = 'services:\n  api:\n    build: ..\n  front:\n    image: nginx\n';

  function issues(extra: string) {
    return prepareCompose(base + extra, vars, ctx).issues;
  }

  it('keeps plain hostnames and aliases in the rendered file', () => {
    const { document } = render('dns-names.yaml');

    expect(service(document, 'api')).toMatchObject({ hostname: 'api-1', networks: { default: { aliases: ['backend', 'api_v2'] }, jobs: null } });
    expect(service(document, 'queue_worker2')).toMatchObject({ hostname: 'worker', domainname: 'preview.internal' });
    expect((document.networks as any).default.enable_ipv6).toBe(false);
  });

  it('reports a reserved name once, whatever its case, and still checks the service', () => {
    expect(issues('  SPAWNER:\n    image: nginx\n    ports: ["80:80"]\n')).toEqual([
      expect.objectContaining({ code: 'compose.forbidden_key', path: 'services.SPAWNER', message: 'service name "SPAWNER" is not allowed' }),
      expect.objectContaining({ code: 'compose.forbidden_key', path: 'services.SPAWNER.ports' }),
    ]);
  });

  it('accepts a name of 63 characters, not 64', () => {
    const name = 'a'.repeat(63);

    expect(issues(`    hostname: ${name}\n`)).toEqual([]);
    expect(issues(`    hostname: ${name}b\n`)).toEqual([expect.objectContaining({ code: 'compose.invalid', path: 'services.front.hostname' })]);
  });

  it('expects aliases as a list of names', () => {
    expect(issues('    networks:\n      default:\n        aliases: backend\n')).toEqual([
      expect.objectContaining({ code: 'compose.invalid', path: 'services.front.networks.default.aliases' }),
    ]);
  });
});

describe('symlinks', () => {
  it('rejects a build context that escapes the sources through a symlink', () => {
    const result = prepareCompose('services:\n  api:\n    build: ../escape\n  front:\n    image: nginx\n', vars, ctx);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'compose.path_outside_sources', path: 'services.api.build.context' }),
    ]);
  });

  it('rejects a bind mount that reaches / through a symlink', () => {
    const result = prepareCompose('services:\n  api:\n    build: ..\n    volumes: ["../rootlink/etc:/host-etc"]\n  front:\n    image: nginx\n', vars, ctx);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'compose.path_outside_sources', path: 'services.api.volumes[0]' }),
    ]);
  });
});

describe('composeProjectName', () => {
  it('keeps distinct projects and environments apart', () => {
    expect(composeProjectName('a-b', 'c')).toBe('spn-a-b--c');
    expect(composeProjectName('a', 'b-c')).toBe('spn-a--b-c');
  });
});
