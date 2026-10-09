import type { Issue } from '../errors';
import { formatSize, parseDuration, parseSize } from '../units';
import { isPlainObject, keyPath, suggest } from '../util';
import { DEFAULT_COMPOSE_LIMITS, type ComposeContext, type ComposeLimits } from './context';
import { defaultRealpath, SourceResolver } from './paths';

const TOP_LEVEL_IGNORED = new Set(['name', 'version']);
const TOP_LEVEL_FORBIDDEN: Record<string, string> = {
  include: 'include is not supported; keep the whole stack in one file',
  secrets: 'secrets are not supported yet; use project variables',
  configs: 'configs are not supported',
  models: 'AI models are not supported',
};
const TOP_LEVEL_KNOWN = ['services', 'volumes', 'networks', ...TOP_LEVEL_IGNORED, ...Object.keys(TOP_LEVEL_FORBIDDEN)];

const SERVICE_ALLOWED = new Set([
  'image',
  'build',
  'command',
  'entrypoint',
  'environment',
  'env_file',
  'depends_on',
  'healthcheck',
  'working_dir',
  'user',
  'expose',
  'volumes',
  'tmpfs',
  'read_only',
  'init',
  'labels',
  'hostname',
  'domainname',
  'extra_hosts',
  'platform',
  'pull_policy',
  'tty',
  'stdin_open',
  'stop_signal',
  'stop_grace_period',
  'cap_drop',
  'shm_size',
  'mem_limit',
  'mem_reservation',
  'memswap_limit',
  'cpus',
  'pids_limit',
  'deploy',
  'networks',
  'links',
  'restart',
  'logging',
  'develop',
]);

/** The least a service gets of the environment's CPUs and processes. */
const MIN_SERVICE_CPUS = 0.05;
const MIN_SERVICE_PIDS = 64;
const CPU_KEYS_HINT = 'use cpus';
const SERVICE_FORBIDDEN: Record<string, string> = {
  privileged: 'containers never run privileged',
  cap_add: 'extra Linux capabilities are not granted; cap_drop is allowed',
  devices: 'host devices are not exposed to environments',
  device_cgroup_rules: 'host devices are not exposed to environments',
  gpus: 'GPUs are not available to environments',
  network_mode: 'services always join the environment network',
  pid: 'the PID namespace cannot be shared',
  ipc: 'the IPC namespace cannot be shared',
  uts: 'the UTS namespace cannot be shared',
  userns_mode: 'the user namespace cannot be changed',
  cgroup: 'the cgroup namespace cannot be changed',
  cgroup_parent: 'the cgroup parent cannot be changed',
  runtime: 'the container runtime cannot be changed',
  isolation: 'the isolation technology cannot be changed',
  sysctls: 'kernel parameters cannot be changed',
  security_opt: 'Spawner sets the security options itself',
  ports: 'host ports are never published; declare an exposure in spawner.yaml',
  container_name: 'Spawner names containers itself',
  volumes_from: 'share a named volume instead',
  external_links: 'services only reach services of the same environment',
  profiles: 'every service in the file is started; remove profiles',
  extends: 'extends is not supported; use YAML anchors in the same file',
  post_start: 'lifecycle hooks are not supported',
  pre_stop: 'lifecycle hooks are not supported',
  oom_kill_disable: 'the OOM killer cannot be disabled',
  oom_score_adj: 'the OOM score cannot be changed',
  ulimits: 'ulimits cannot be changed',
  secrets: 'secrets are not supported yet; use project variables',
  configs: 'configs are not supported',
  label_file: 'label files are not supported; declare labels inline',
  use_api_socket: 'the Docker socket is never exposed to environments',
  provider: 'provider services are not supported',
  scale: 'each service runs a single container',
  storage_opt: 'storage options cannot be changed',
  blkio_config: 'block IO settings cannot be changed',
  mac_address: 'MAC addresses cannot be set',
  credential_spec: 'credential specs are not supported',
  annotations: 'annotations are not supported',
  models: 'AI models are not supported',
  cpu_shares: CPU_KEYS_HINT,
  cpu_quota: CPU_KEYS_HINT,
  cpu_period: CPU_KEYS_HINT,
  cpu_rt_runtime: CPU_KEYS_HINT,
  cpu_rt_period: CPU_KEYS_HINT,
  cpu_count: CPU_KEYS_HINT,
  cpu_percent: CPU_KEYS_HINT,
  cpuset: CPU_KEYS_HINT,
};

const BUILD_ALLOWED = new Set(['context', 'dockerfile', 'dockerfile_inline', 'args', 'target', 'extra_hosts', 'pull', 'no_cache', 'labels']);
const BUILD_FORBIDDEN: Record<string, string> = {
  network: 'builds use the default build network',
  ssh: 'SSH agent forwarding is not available to builds',
  secrets: 'build secrets are not supported yet',
  privileged: 'builds never run privileged',
  entitlements: 'build entitlements are not granted',
  additional_contexts: 'only the build context of a declared source is available',
  tags: 'Spawner names built images itself',
  platforms: 'multi-platform builds are not supported',
  cache_from: 'external build caches are not supported',
  cache_to: 'external build caches are not supported',
  shm_size: 'the build shared memory cannot be changed',
  isolation: 'the build isolation cannot be changed',
  ulimits: 'build ulimits cannot be changed',
  provenance: 'provenance attestations are not supported',
  sbom: 'SBOM attestations are not supported',
};

const HEALTHCHECK_KEYS = new Set(['test', 'interval', 'timeout', 'retries', 'start_period', 'start_interval', 'disable']);
const DEPENDS_ON_KEYS = new Set(['condition', 'restart', 'required']);
const DEPENDS_ON_CONDITIONS = new Set(['service_started', 'service_healthy', 'service_completed_successfully']);
const VOLUME_LONG_KEYS = new Set(['type', 'source', 'target', 'read_only', 'consistency', 'volume', 'bind', 'tmpfs']);
const VOLUME_MODE = /^(ro|rw|z|Z|cached|delegated|consistent|nocopy)(,(ro|rw|z|Z|cached|delegated|consistent|nocopy))*$/;
const RESERVED_LABEL_PREFIXES = ['traefik.', 'com.docker.', 'dev.spawner.'];
const RESOURCE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const DNS_NAME = /^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;
const DNS_NAME_HINT = 'use at most 63 lowercase letters, digits, - and _, without dots and not ending with -: it is a DNS name on the environment network';
const HOSTNAME_HINT = `${DNS_NAME_HINT}; a domain goes in domainname`;
const RESERVED_NAME_PREFIXES = ['spawner', 'spn-'];
const RESERVED_NAME_HINT = 'names starting with spawner or spn- are reserved for Spawner';

/**
 * A service once validated. spec only keeps the keys Spawner lets through,
 * with every path made absolute; restart, logging, limits and security
 * options are set when rendering.
 */
export interface NormalizedService {
  name: string;
  spec: Record<string, unknown>;
  memoryBytes: number;
  cpus: number;
  pids: number;
  networks: string[] | null;
}

export interface NormalizedCompose {
  services: NormalizedService[];
  volumes: Record<string, Record<string, unknown>>;
  networks: Record<string, Record<string, unknown>>;
  /** Sources with files mounted in a service: they must stay on disk. */
  bindSources: string[];
  /** Sources holding an env_file: Compose reads them whenever it loads the project. */
  envFileSources: string[];
  /** Services that mount files of a source: they see new code only once recreated. */
  servicesMountingSources: string[];
}

interface ServiceDraft {
  name: string;
  spec: Record<string, unknown>;
  memoryBytes?: number;
  cpus?: number;
  pids?: number;
  deployMemoryBytes?: number;
  deployCpus?: number;
  deployPids?: number;
  networks: string[] | null;
  dependsOn: { name: string; path: string }[];
  links: { name: string; path: string }[];
}

/**
 * Validates an interpolated compose document against the Spawner policy:
 * every key must be explicitly allowed, every path must stay inside the
 * environment sources, references must exist and resources must fit the
 * environment budget. Collects every problem instead of stopping at the first.
 *
 * @param doc - Parsed and interpolated compose document
 * @param ctx - Environment context (sources, exposures, limits)
 * @param issues - Collector for problems found
 * @returns The normalized model to render; only meaningful when no issue was added
 */
export function validateCompose(doc: Record<string, unknown>, ctx: ComposeContext, issues: Issue[]): NormalizedCompose {
  return new ComposeValidator(ctx, issues).run(doc);
}

class ComposeValidator {
  private readonly limits: ComposeLimits;
  private readonly resolver: SourceResolver;
  private readonly bindSources = new Set<string>();
  private readonly envFileSources = new Set<string>();
  private readonly mountingServices = new Set<string>();
  private declaredVolumes = new Set<string>();
  private declaredNetworks = new Set<string>(['default']);

  constructor(
    private readonly ctx: ComposeContext,
    private readonly issues: Issue[],
  ) {
    this.limits = { ...DEFAULT_COMPOSE_LIMITS, ...ctx.limits };
    this.resolver = new SourceResolver(ctx.sourceRoots, ctx.realpath ?? defaultRealpath);
  }

  run(doc: Record<string, unknown>): NormalizedCompose {
    for (const key of Object.keys(doc)) {
      if (['services', 'volumes', 'networks'].includes(key) || TOP_LEVEL_IGNORED.has(key) || key.startsWith('x-')) {
        continue;
      }
      if (key in TOP_LEVEL_FORBIDDEN) {
        this.forbidden(key, key, TOP_LEVEL_FORBIDDEN[key]);
      } else {
        this.unknown(key, key, TOP_LEVEL_KNOWN);
      }
    }

    const volumes = this.topLevelVolumes(doc.volumes);
    const networks = this.topLevelNetworks(doc.networks);
    const drafts = this.services(doc.services);
    const services = this.crossCheck(drafts);

    return {
      services,
      volumes,
      networks,
      bindSources: [...this.bindSources],
      envFileSources: [...this.envFileSources],
      servicesMountingSources: [...this.mountingServices],
    };
  }

  private topLevelVolumes(value: unknown): Record<string, Record<string, unknown>> {
    const result: Record<string, Record<string, unknown>> = {};
    if (value === undefined || value === null) {
      return result;
    }
    if (!isPlainObject(value)) {
      this.invalid('volumes', 'volumes must be a mapping of volume names');
      return result;
    }
    for (const [name, definition] of Object.entries(value)) {
      const path = keyPath('volumes', name);
      if (!RESOURCE_NAME.test(name)) {
        this.invalid(path, `invalid volume name "${name}"`);
        continue;
      }
      this.declaredVolumes.add(name);
      result[name] = {};
      if (definition === null || definition === undefined) {
        continue;
      }
      if (!isPlainObject(definition)) {
        this.invalid(path, 'a volume definition must be a mapping');
        continue;
      }
      for (const [key, item] of Object.entries(definition)) {
        const itemPath = keyPath(path, key);
        if (key.startsWith('x-')) {
          continue;
        }
        if (key === 'labels') {
          result[name].labels = this.labels(item, itemPath);
        } else if (['name', 'external', 'driver', 'driver_opts'].includes(key)) {
          this.forbidden(itemPath, key, 'volumes are local to the environment; Spawner names and creates them');
        } else {
          this.unknown(itemPath, key, ['labels']);
        }
      }
    }
    return result;
  }

  private topLevelNetworks(value: unknown): Record<string, Record<string, unknown>> {
    const result: Record<string, Record<string, unknown>> = {};
    if (value === undefined || value === null) {
      return result;
    }
    if (!isPlainObject(value)) {
      this.invalid('networks', 'networks must be a mapping of network names');
      return result;
    }
    for (const [name, definition] of Object.entries(value)) {
      const path = keyPath('networks', name);
      if (!RESOURCE_NAME.test(name)) {
        this.invalid(path, `invalid network name "${name}"`);
        continue;
      }
      this.declaredNetworks.add(name);
      result[name] = {};
      if (definition === null || definition === undefined) {
        continue;
      }
      if (!isPlainObject(definition)) {
        this.invalid(path, 'a network definition must be a mapping');
        continue;
      }
      for (const [key, item] of Object.entries(definition)) {
        const itemPath = keyPath(path, key);
        if (key.startsWith('x-')) {
          continue;
        }
        if (key === 'labels') {
          result[name].labels = this.labels(item, itemPath);
        } else if (key === 'internal' || key === 'enable_ipv6') {
          if (typeof item !== 'boolean') {
            this.invalid(itemPath, `${key} must be true or false`);
          } else if (key === 'enable_ipv6' && item) {
            this.forbidden(itemPath, 'enable_ipv6: true', 'environment networks are IPv4 only');
          } else {
            result[name][key] = item;
          }
        } else if (key === 'driver') {
          if (item !== 'bridge') {
            this.forbidden(itemPath, key, 'only the bridge driver is available');
          } else {
            result[name].driver = item;
          }
        } else if (['name', 'external', 'driver_opts', 'ipam', 'attachable'].includes(key)) {
          this.forbidden(itemPath, key, 'networks are local to the environment; Spawner names and creates them');
        } else {
          this.unknown(itemPath, key, ['labels', 'internal', 'enable_ipv6', 'driver']);
        }
      }
    }
    return result;
  }

  private services(value: unknown): ServiceDraft[] {
    if (!isPlainObject(value) || Object.keys(value).length === 0) {
      this.invalid('services', 'the compose file must declare at least one service');
      return [];
    }
    const names = Object.keys(value);
    if (names.length > this.limits.maxServices) {
      this.issues.push({
        code: 'compose.limit_exceeded',
        path: 'services',
        message: `${names.length} services declared, the limit is ${this.limits.maxServices}`,
      });
    }
    return names
      .map((name) => this.service(name, value[name]))
      .filter((draft): draft is ServiceDraft => draft !== null);
  }

  private service(name: string, value: unknown): ServiceDraft | null {
    const path = keyPath('services', name);
    this.dnsName(name, path, 'service name');
    if (!isPlainObject(value)) {
      this.invalid(path, 'a service must be a mapping');
      return null;
    }

    const draft: ServiceDraft = { name, spec: {}, networks: null, dependsOn: [], links: [] };
    for (const [key, item] of Object.entries(value)) {
      const itemPath = keyPath(path, key);
      if (key.startsWith('x-')) {
        continue;
      }
      if (key in SERVICE_FORBIDDEN) {
        this.forbidden(itemPath, key, SERVICE_FORBIDDEN[key]);
        continue;
      }
      if (!SERVICE_ALLOWED.has(key)) {
        this.unknown(itemPath, key, SERVICE_ALLOWED);
        continue;
      }
      this.serviceKey(draft, key, item, itemPath);
    }

    if ('build' in value) {
      delete draft.spec.image;
    } else if (!('image' in value)) {
      this.invalid(path, 'a service needs an image or a build');
    }
    return draft;
  }

  private serviceKey(draft: ServiceDraft, key: string, value: unknown, path: string): void {
    const spec = draft.spec;
    switch (key) {
      case 'hostname':
        if (this.expectString(value, path) && this.dnsName(value, path, 'hostname', HOSTNAME_HINT)) {
          spec.hostname = value;
        }
        return;
      case 'image':
      case 'working_dir':
      case 'user':
      case 'domainname':
      case 'platform':
      case 'stop_signal':
      case 'pull_policy':
        if (this.expectString(value, path)) {
          spec[key] = value;
        }
        return;
      case 'read_only':
      case 'init':
      case 'tty':
      case 'stdin_open':
        if (typeof value !== 'boolean') {
          this.invalid(path, `${key} must be true or false`);
        } else {
          spec[key] = value;
        }
        return;
      case 'command':
      case 'entrypoint':
        if (typeof value === 'string' || this.isStringList(value)) {
          spec[key] = value;
        } else {
          this.invalid(path, `${key} must be a string or a list of strings`);
        }
        return;
      case 'environment':
        if (this.isScalarMap(value) || this.isStringList(value)) {
          spec[key] = value;
        } else {
          this.invalid(path, 'environment must be a mapping or a list of KEY=value');
        }
        return;
      case 'expose':
      case 'cap_drop':
        if (Array.isArray(value) && value.every((item) => typeof item === 'string' || typeof item === 'number')) {
          spec[key] = value;
        } else {
          this.invalid(path, `${key} must be a list`);
        }
        return;
      case 'extra_hosts':
        if (this.isStringList(value) || this.isScalarMap(value)) {
          spec[key] = value;
        } else {
          this.invalid(path, 'extra_hosts must be a list or a mapping');
        }
        return;
      case 'tmpfs':
        if (typeof value === 'string' || this.isStringList(value)) {
          spec[key] = value;
        } else {
          this.invalid(path, 'tmpfs must be a string or a list of strings');
        }
        return;
      case 'labels':
        spec.labels = this.labels(value, path);
        return;
      case 'build':
        this.build(spec, value, path);
        return;
      case 'env_file':
        this.envFile(spec, value, path);
        return;
      case 'volumes':
        this.serviceVolumes(draft.name, spec, value, path);
        return;
      case 'networks':
        this.serviceNetworks(draft, value, path);
        return;
      case 'depends_on':
        this.dependsOn(draft, value, path);
        return;
      case 'links':
        if (!this.isStringList(value)) {
          this.invalid(path, 'links must be a list of service names');
          return;
        }
        spec.links = value;
        value.forEach((link, index) => draft.links.push({ name: link.split(':')[0], path: keyPath(path, index) }));
        return;
      case 'healthcheck':
        this.healthcheck(spec, value, path);
        return;
      case 'deploy':
        this.deploy(draft, value, path);
        return;
      case 'mem_limit': {
        const bytes = this.size(value, path);
        if (bytes !== null) {
          draft.memoryBytes = bytes;
        }
        return;
      }
      case 'mem_reservation':
      case 'memswap_limit': {
        const bytes = this.size(value, path);
        if (bytes !== null) {
          spec[key] = bytes;
        }
        return;
      }
      case 'cpus': {
        const cpus = this.cpus(value, path);
        if (cpus !== null) {
          draft.cpus = cpus;
        }
        return;
      }
      case 'pids_limit': {
        const pids = this.pids(value, path);
        if (pids !== null) {
          draft.pids = pids;
        }
        return;
      }
      case 'shm_size': {
        const bytes = this.size(value, path);
        if (bytes === null) {
          return;
        }
        if (bytes > this.limits.shmMaxBytes) {
          this.limit(path, `shm_size is ${formatSize(bytes)}, the limit is ${formatSize(this.limits.shmMaxBytes)}`);
          return;
        }
        spec.shm_size = bytes;
        return;
      }
      case 'stop_grace_period': {
        const seconds = parseDuration(value);
        if (seconds === null) {
          this.invalid(path, 'stop_grace_period must be a duration such as "10s"');
        } else if (seconds > this.limits.stopGraceMaxSeconds) {
          this.limit(path, `stop_grace_period is ${seconds}s, the limit is ${this.limits.stopGraceMaxSeconds}s`);
        } else {
          spec.stop_grace_period = value;
        }
        return;
      }
      default:
        return;
    }
  }

  private build(spec: Record<string, unknown>, value: unknown, path: string): void {
    const build = typeof value === 'string' ? { context: value } : value;
    if (!isPlainObject(build)) {
      this.invalid(path, 'build must be a path or a mapping');
      return;
    }
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(build)) {
      const itemPath = keyPath(path, key);
      if (key.startsWith('x-') || key === 'context' || key === 'dockerfile') {
        continue;
      }
      if (key in BUILD_FORBIDDEN) {
        this.forbidden(itemPath, key, BUILD_FORBIDDEN[key]);
      } else if (!BUILD_ALLOWED.has(key)) {
        this.unknown(itemPath, key, BUILD_ALLOWED);
      } else if (key === 'labels') {
        output.labels = this.labels(item, itemPath);
      } else {
        output[key] = item;
      }
    }

    const context = build.context ?? '.';
    const contextPath = keyPath(path, 'context');
    if (typeof context !== 'string') {
      this.invalid(contextPath, 'build context must be a path');
      return;
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(context) || context.startsWith('git@')) {
      this.forbidden(contextPath, 'context', 'remote build contexts are not allowed; build from a source declared in spawner.yaml');
      return;
    }
    const resolvedContext = this.resolver.resolve(context, this.ctx.composeDir, 'build context', contextPath, this.issues);
    if (!resolvedContext) {
      return;
    }
    output.context = resolvedContext.path;

    if (build.dockerfile !== undefined) {
      const dockerfilePath = keyPath(path, 'dockerfile');
      if (!this.expectString(build.dockerfile, dockerfilePath)) {
        return;
      }
      const dockerfile = this.resolver.resolve(build.dockerfile, resolvedContext.path, 'Dockerfile', dockerfilePath, this.issues);
      if (!dockerfile) {
        return;
      }
      output.dockerfile = dockerfile.path;
    }
    spec.build = output;
  }

  private envFile(spec: Record<string, unknown>, value: unknown, path: string): void {
    const entries = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(entries)) {
      this.invalid(path, 'env_file must be a path or a list');
      return;
    }
    const output: unknown[] = [];
    entries.forEach((entry, index) => {
      const entryPath = typeof value === 'string' ? path : keyPath(path, index);
      if (typeof entry === 'string') {
        const resolved = this.resolver.resolve(entry, this.ctx.composeDir, 'env file', entryPath, this.issues);
        if (resolved) {
          output.push(resolved.path);
          this.envFileSources.add(resolved.source);
        }
        return;
      }
      if (!isPlainObject(entry) || typeof entry.path !== 'string') {
        this.invalid(entryPath, 'an env_file entry must be a path or a mapping with a path');
        return;
      }
      for (const key of Object.keys(entry)) {
        if (!['path', 'required', 'format'].includes(key)) {
          this.unknown(keyPath(entryPath, key), key, ['path', 'required', 'format']);
        }
      }
      const required = entry.required !== false;
      const resolved = this.resolver.resolve(entry.path, this.ctx.composeDir, 'env file', keyPath(entryPath, 'path'), this.issues, required);
      if (resolved) {
        output.push({ ...entry, path: resolved.path });
        this.envFileSources.add(resolved.source);
      }
    });
    spec.env_file = output;
  }

  private serviceVolumes(service: string, spec: Record<string, unknown>, value: unknown, path: string): void {
    if (!Array.isArray(value)) {
      this.invalid(path, 'volumes must be a list');
      return;
    }
    const output: unknown[] = [];
    value.forEach((item, index) => {
      const itemPath = keyPath(path, index);
      if (typeof item === 'string') {
        const volume = this.shortVolume(service, item, itemPath);
        if (volume !== null) {
          output.push(volume);
        }
      } else if (isPlainObject(item)) {
        const volume = this.longVolume(service, item, itemPath);
        if (volume !== null) {
          output.push(volume);
        }
      } else {
        this.invalid(itemPath, 'a volume must be a string or a mapping');
      }
    });
    spec.volumes = output;
  }

  private shortVolume(service: string, value: string, path: string): string | null {
    const parts = value.split(':');
    let source: string | undefined;
    let target: string;
    let mode: string | undefined;
    if (parts.some((part) => part === '') || parts.length > 3) {
      this.invalid(path, `invalid volume "${value}"`);
      return null;
    }
    if (parts.length === 1) {
      target = parts[0];
    } else if (parts.length === 2 && parts[1].startsWith('/')) {
      [source, target] = parts;
    } else if (parts.length === 2 && VOLUME_MODE.test(parts[1])) {
      [target, mode] = parts;
    } else if (parts.length === 3) {
      [source, target, mode] = parts;
    } else {
      this.invalid(path, `invalid volume "${value}"`, 'the container path must be absolute');
      return null;
    }
    if (mode !== undefined && !VOLUME_MODE.test(mode)) {
      this.invalid(path, `invalid volume mode "${mode}"`);
      return null;
    }
    if (source === undefined) {
      return value;
    }
    if (this.isBindSource(source)) {
      const resolved = this.resolver.resolve(source, this.ctx.composeDir, 'bind mount source', path, this.issues);
      if (!resolved) {
        return null;
      }
      this.bindSources.add(resolved.source);
      this.mountingServices.add(service);
      return [resolved.path, target, mode].filter((part) => part !== undefined).join(':');
    }
    if (!this.declaredVolumes.has(source)) {
      this.undefinedReference(path, `volume "${source}" is not declared under the top-level volumes`);
      return null;
    }
    return value;
  }

  private longVolume(service: string, value: Record<string, unknown>, path: string): Record<string, unknown> | null {
    for (const key of Object.keys(value)) {
      if (!VOLUME_LONG_KEYS.has(key) && !key.startsWith('x-')) {
        this.unknown(keyPath(path, key), key, VOLUME_LONG_KEYS);
        return null;
      }
    }
    const output: Record<string, unknown> = Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('x-')));
    if (typeof value.target !== 'string' || !value.target.startsWith('/')) {
      this.invalid(keyPath(path, 'target'), 'target must be an absolute path in the container');
      return null;
    }
    switch (value.type) {
      case 'volume':
        if (!this.subKeys(value.volume, ['nocopy', 'subpath'], keyPath(path, 'volume'))) {
          return null;
        }
        if (value.source !== undefined) {
          if (typeof value.source !== 'string' || !this.declaredVolumes.has(value.source)) {
            this.undefinedReference(keyPath(path, 'source'), `volume "${String(value.source)}" is not declared under the top-level volumes`);
            return null;
          }
        }
        return output;
      case 'bind': {
        if (!this.subKeys(value.bind, ['selinux', 'create_host_path'], keyPath(path, 'bind'))) {
          return null;
        }
        if (typeof value.source !== 'string') {
          this.invalid(keyPath(path, 'source'), 'a bind mount needs a source');
          return null;
        }
        const resolved = this.resolver.resolve(value.source, this.ctx.composeDir, 'bind mount source', keyPath(path, 'source'), this.issues);
        if (!resolved) {
          return null;
        }
        this.bindSources.add(resolved.source);
        this.mountingServices.add(service);
        return { ...output, source: resolved.path };
      }
      case 'tmpfs':
        return this.subKeys(value.tmpfs, ['size', 'mode'], keyPath(path, 'tmpfs')) ? output : null;
      default:
        this.forbidden(keyPath(path, 'type'), `type: ${String(value.type)}`, 'only volume, bind and tmpfs mounts are available');
        return null;
    }
  }

  private serviceNetworks(draft: ServiceDraft, value: unknown, path: string): void {
    let names: string[];
    if (this.isStringList(value)) {
      names = value;
    } else if (isPlainObject(value)) {
      names = Object.keys(value);
      for (const [name, options] of Object.entries(value)) {
        if (options === null || options === undefined) {
          continue;
        }
        if (!this.subKeys(options, ['aliases'], keyPath(path, name))) {
          return;
        }
        this.aliases((options as Record<string, unknown>).aliases, keyPath(keyPath(path, name), 'aliases'));
      }
    } else {
      this.invalid(path, 'networks must be a list or a mapping');
      return;
    }
    for (const name of names) {
      if (!this.declaredNetworks.has(name)) {
        this.undefinedReference(keyPath(path, name), `network "${name}" is not declared under the top-level networks`);
      }
    }
    draft.networks = names;
    draft.spec.networks = value;
  }

  private aliases(value: unknown, path: string): void {
    if (value === undefined) {
      return;
    }
    if (!this.isStringList(value)) {
      this.invalid(path, 'aliases must be a list of names');
      return;
    }
    value.forEach((alias, index) => this.dnsName(alias, keyPath(path, index), 'alias'));
  }

  /**
   * Checks a name that Docker registers in the DNS of the environment's
   * networks: a service name, a network alias or a hostname. Traefik joins
   * those networks and reaches its upstreams by network-qualified names
   * ("spawner.spawner-core"), so a name must be a single lowercase label,
   * which can never pass for a qualified name, and never one of Spawner's.
   *
   * @returns Whether the name is accepted
   */
  private dnsName(name: string, path: string, kind: string, hint = DNS_NAME_HINT): boolean {
    const lower = name.toLowerCase();
    if (RESERVED_NAME_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
      this.forbidden(path, `${kind} "${name}"`, RESERVED_NAME_HINT);
      return false;
    }
    if (!DNS_NAME.test(name)) {
      this.invalid(path, `invalid ${kind} "${name}"`, hint);
      return false;
    }
    return true;
  }

  private dependsOn(draft: ServiceDraft, value: unknown, path: string): void {
    if (this.isStringList(value)) {
      value.forEach((name, index) => draft.dependsOn.push({ name, path: keyPath(path, index) }));
      draft.spec.depends_on = value;
      return;
    }
    if (!isPlainObject(value)) {
      this.invalid(path, 'depends_on must be a list or a mapping');
      return;
    }
    for (const [name, options] of Object.entries(value)) {
      const itemPath = keyPath(path, name);
      draft.dependsOn.push({ name, path: itemPath });
      if (options === null || options === undefined) {
        continue;
      }
      if (!this.subKeys(options, DEPENDS_ON_KEYS, itemPath)) {
        return;
      }
      const condition = (options as Record<string, unknown>).condition;
      if (condition !== undefined && !DEPENDS_ON_CONDITIONS.has(condition as string)) {
        this.invalid(keyPath(itemPath, 'condition'), `unknown condition "${String(condition)}"`);
      }
    }
    draft.spec.depends_on = value;
  }

  private healthcheck(spec: Record<string, unknown>, value: unknown, path: string): void {
    if (this.subKeys(value, HEALTHCHECK_KEYS, path)) {
      spec.healthcheck = value;
    }
  }

  private deploy(draft: ServiceDraft, value: unknown, path: string): void {
    if (!isPlainObject(value)) {
      this.invalid(path, 'deploy must be a mapping');
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      const itemPath = keyPath(path, key);
      if (key.startsWith('x-')) {
        continue;
      }
      if (key === 'replicas') {
        if (item !== 1) {
          this.limit(itemPath, 'each service runs a single container');
        }
      } else if (key === 'resources') {
        this.deployResources(draft, item, itemPath);
      } else {
        this.forbidden(itemPath, key, 'only deploy.resources and deploy.replicas: 1 are supported');
      }
    }
  }

  private deployResources(draft: ServiceDraft, value: unknown, path: string): void {
    if (!this.subKeys(value, ['limits', 'reservations'], path)) {
      return;
    }
    const resources = value as Record<string, unknown>;
    if (resources.limits !== undefined) {
      const limitsPath = keyPath(path, 'limits');
      if (!this.subKeys(resources.limits, ['cpus', 'memory', 'pids'], limitsPath)) {
        return;
      }
      const limits = resources.limits as Record<string, unknown>;
      if (limits.memory !== undefined) {
        draft.deployMemoryBytes = this.size(limits.memory, keyPath(limitsPath, 'memory')) ?? undefined;
      }
      if (limits.cpus !== undefined) {
        draft.deployCpus = this.cpus(limits.cpus, keyPath(limitsPath, 'cpus')) ?? undefined;
      }
      if (limits.pids !== undefined) {
        draft.deployPids = this.pids(limits.pids, keyPath(limitsPath, 'pids')) ?? undefined;
      }
    }
    if (resources.reservations !== undefined) {
      const reservationsPath = keyPath(path, 'reservations');
      if (!this.subKeys(resources.reservations, ['cpus', 'memory'], reservationsPath)) {
        return;
      }
      const reservations = resources.reservations as Record<string, unknown>;
      if (reservations.memory !== undefined) {
        const bytes = this.size(reservations.memory, keyPath(reservationsPath, 'memory'));
        if (bytes !== null) {
          draft.spec.mem_reservation = bytes;
        }
      }
    }
  }

  private crossCheck(drafts: ServiceDraft[]): NormalizedService[] {
    const byName = new Map(drafts.map((draft) => [draft.name, draft]));

    for (const draft of drafts) {
      for (const reference of [...draft.dependsOn, ...draft.links]) {
        if (!byName.has(reference.name)) {
          this.undefinedReference(reference.path, `service "${reference.name}" is not declared`);
        }
      }
    }

    this.ctx.exposures.forEach((exposure) => {
      const service = byName.get(exposure.service);
      const path = keyPath('services', exposure.service);
      if (!service) {
        this.issues.push({
          code: 'compose.undefined_reference',
          path,
          message: `exposure "${exposure.name}" targets service "${exposure.service}", which is not declared`,
        });
      } else if (service.networks !== null && !service.networks.includes('default')) {
        this.issues.push({
          code: 'compose.not_exposable',
          path: keyPath(path, 'networks'),
          message: `service "${exposure.service}" is exposed but not attached to the default network`,
          hint: 'add "default" to its networks',
        });
      }
    });

    this.ctx.seedServices.forEach((name) => {
      if (!byName.has(name)) {
        this.issues.push({
          code: 'compose.undefined_reference',
          path: keyPath('services', name),
          message: `a seed step runs in service "${name}", which is not declared`,
        });
      }
    });

    return this.allocate(drafts);
  }

  /**
   * Services with an explicit memory limit keep it; the rest of the
   * environment budget is shared by the others, up to the per-service
   * default. CPUs and processes are shared the same way, so that an
   * environment of many services cannot take the server's.
   */
  private allocate(drafts: ServiceDraft[]): NormalizedService[] {
    const explicit = new Map<string, number>();
    for (const draft of drafts) {
      const memory = draft.memoryBytes ?? draft.deployMemoryBytes;
      if (memory !== undefined) {
        explicit.set(draft.name, memory);
      }
    }
    const explicitTotal = [...explicit.values()].reduce((sum, bytes) => sum + bytes, 0);
    const budget = this.limits.envMemoryBytes;
    if (explicitTotal > budget) {
      this.limit('services', `services ask for ${formatSize(explicitTotal)} of memory, the environment limit is ${formatSize(budget)}`, 'lower mem_limit, or raise limits.memory in spawner.yaml within the server limit');
    }

    const implicitCount = drafts.length - explicit.size;
    const share = implicitCount > 0 ? Math.min(this.limits.serviceMemoryDefaultBytes, Math.floor((budget - explicitTotal) / implicitCount)) : 0;
    if (implicitCount > 0 && explicitTotal <= budget && share < this.limits.minServiceMemoryBytes) {
      this.limit('services', `only ${formatSize(Math.max(0, budget - explicitTotal))} of memory is left for ${implicitCount} services without mem_limit`, 'set mem_limit on every service');
    }

    const cpus = this.spread(
      drafts.map((draft) => draft.cpus ?? draft.deployCpus),
      { budget: this.limits.envCpus, perService: this.limits.cpusDefault, minimum: MIN_SERVICE_CPUS, round: (value) => Math.floor(value * 100) / 100 },
      { unit: 'CPUs', key: 'cpus' },
    );
    const pids = this.spread(
      drafts.map((draft) => draft.pids ?? draft.deployPids),
      { budget: this.limits.envPids, perService: this.limits.pidsDefault, minimum: MIN_SERVICE_PIDS, round: Math.floor },
      { unit: 'processes', key: 'pids_limit' },
    );
    return drafts.map((draft, index) => ({
      name: draft.name,
      spec: draft.spec,
      memoryBytes: explicit.get(draft.name) ?? share,
      cpus: cpus[index],
      pids: pids[index],
      networks: draft.networks,
    }));
  }

  /**
   * Shares an environment budget between its services: an explicit value is
   * kept, the services without one share what is left, up to the default per
   * service.
   *
   * @returns The value of each service, in the order given
   */
  private spread(
    explicit: (number | undefined)[],
    rule: { budget: number; perService: number; minimum: number; round: (value: number) => number },
    words: { unit: string; key: string },
  ): number[] {
    const total = explicit.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const implicit = explicit.filter((value) => value === undefined).length;
    if (total > rule.budget) {
      this.limit('services', `services ask for ${total} ${words.unit}, the environment limit is ${rule.budget}`, `lower ${words.key}`);
    }
    const share = implicit > 0 ? Math.min(rule.perService, rule.round((rule.budget - total) / implicit)) : 0;
    if (implicit > 0 && total <= rule.budget && share < rule.minimum) {
      this.limit('services', `only ${Math.max(0, rule.budget - total)} ${words.unit} are left for ${implicit} services without ${words.key}`, `set ${words.key} on every service`);
    }
    return explicit.map((value) => value ?? share);
  }

  private labels(value: unknown, path: string): Record<string, string> {
    const labels: Record<string, string> = {};
    if (this.isStringList(value)) {
      for (const entry of value) {
        const separator = entry.indexOf('=');
        labels[separator === -1 ? entry : entry.slice(0, separator)] = separator === -1 ? '' : entry.slice(separator + 1);
      }
    } else if (this.isScalarMap(value)) {
      for (const [key, item] of Object.entries(value)) {
        labels[key] = item === null || item === undefined ? '' : String(item);
      }
    } else {
      this.invalid(path, 'labels must be a mapping or a list of key=value');
      return labels;
    }
    for (const key of Object.keys(labels)) {
      if (RESERVED_LABEL_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        this.forbidden(keyPath(path, key), key, 'traefik.*, com.docker.* and dev.spawner.* labels are managed by Spawner; routing is declared with exposures');
      }
    }
    return labels;
  }

  private size(value: unknown, path: string): number | null {
    const bytes = parseSize(value);
    if (bytes === null || bytes <= 0) {
      this.invalid(path, 'expected a size such as "512m" or "1g"');
      return null;
    }
    if (bytes > this.limits.envMemoryBytes && /mem|memory/.test(path)) {
      this.limit(path, `${formatSize(bytes)} is above the environment limit of ${formatSize(this.limits.envMemoryBytes)}`);
      return null;
    }
    return bytes;
  }

  private cpus(value: unknown, path: string): number | null {
    const cpus = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(cpus) || cpus <= 0) {
      this.invalid(path, 'cpus must be a positive number');
      return null;
    }
    if (cpus > this.limits.cpusMax) {
      this.limit(path, `${cpus} CPUs requested, the limit is ${this.limits.cpusMax}`);
      return null;
    }
    return cpus;
  }

  private pids(value: unknown, path: string): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      this.invalid(path, 'pids_limit must be a positive integer');
      return null;
    }
    if (value > this.limits.pidsMax) {
      this.limit(path, `${value} processes requested, the limit is ${this.limits.pidsMax}`);
      return null;
    }
    return value;
  }

  private subKeys(value: unknown, allowed: Iterable<string>, path: string): boolean {
    if (!isPlainObject(value)) {
      if (value === undefined) {
        return true;
      }
      this.invalid(path, 'expected a mapping');
      return false;
    }
    const allowedSet = new Set(allowed);
    let valid = true;
    for (const key of Object.keys(value)) {
      if (!allowedSet.has(key) && !key.startsWith('x-')) {
        this.unknown(keyPath(path, key), key, allowedSet);
        valid = false;
      }
    }
    return valid;
  }

  private isBindSource(source: string): boolean {
    return source.startsWith('.') || source.startsWith('/') || source.startsWith('~');
  }

  private isStringList(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
  }

  private isScalarMap(value: unknown): value is Record<string, string | number | boolean | null> {
    return isPlainObject(value) && Object.values(value).every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item));
  }

  private expectString(value: unknown, path: string): value is string {
    if (typeof value !== 'string') {
      this.invalid(path, 'expected a string');
      return false;
    }
    return true;
  }

  private invalid(path: string, message: string, hint?: string): void {
    this.issues.push({ code: 'compose.invalid', path, message, hint });
  }

  private forbidden(path: string, key: string, hint: string): void {
    this.issues.push({ code: 'compose.forbidden_key', path, message: `${key} is not allowed`, hint });
  }

  private unknown(path: string, key: string, known: Iterable<string>): void {
    const suggestion = suggest(key, known);
    this.issues.push({
      code: 'compose.unknown_key',
      path,
      message: `unknown or unsupported key "${key}"`,
      hint: suggestion ? `did you mean "${suggestion}"?` : undefined,
    });
  }

  private undefinedReference(path: string, message: string): void {
    this.issues.push({ code: 'compose.undefined_reference', path, message });
  }

  private limit(path: string, message: string, hint?: string): void {
    this.issues.push({ code: 'compose.limit_exceeded', path, message, hint });
  }
}
