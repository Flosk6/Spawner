// Shapes returned by the Spawner API, shared by the web UI and the CLI.
// Dates are ISO 8601 strings once they went through JSON.

// Accounts and access

export type Role = 'admin' | 'member';

/**
 * What a session or a token may do: envs:read (list, logs, resources),
 * envs:write (create, update, share, delete), envs:exec (commands and
 * terminals), preview (open previews), admin (projects, team, settings).
 */
export type Scope = 'envs:read' | 'envs:write' | 'envs:exec' | 'preview' | 'admin';

export interface User {
  id: number;
  name: string;
  role: Role;
  avatarUrl: string | null;
  email: string | null;
}

export interface AuthSession {
  user: User | null;
  methods: { passkey: boolean; github: boolean };
}

/** Who makes a request (GET /api/v1/auth/whoami). */
export interface WhoAmI {
  via: 'session' | 'token' | 'bootstrap';
  user: User | null;
  scopes: Scope[];
  token: { id: string; name: string; hint: string; project: string | null; expiresAt: string | null } | null;
}

/** What an installation is and the rules it applies (GET /api/v1/info). */
export interface ServerInfo {
  version: string;
  dashboardUrl: string;
  previewDomain: string;
  scheme: 'http' | 'https';
  limits: {
    /** The compose limits of @spawner/core, plus the most memory an environment may ask for. */
    compose: {
      envMemoryBytes: number;
      serviceMemoryDefaultBytes: number;
      minServiceMemoryBytes: number;
      cpusDefault: number;
      cpusMax: number;
      pidsDefault: number;
      pidsMax: number;
      shmMaxBytes: number;
      stopGraceMaxSeconds: number;
      maxServices: number;
      envMemoryMaxBytes: number;
    };
    upload: { maxBytes: number; maxFiles: number; maxExtractedBytes: number };
    ttl: { defaultSeconds: number; minSeconds: number; maxSeconds: number };
    exec: { maxSeconds: number; maxOutputBytes: number; maxStdinBytes: number };
    share: { defaultHours: number; maxHours: number };
  };
}

export interface TeamMember extends User {
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  passkeys: number;
  environments: number;
  /** Linked GitHub login. */
  github: string | null;
}

export interface PasskeyInfo {
  id: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface Account {
  user: User;
  passkeys: PasskeyInfo[];
  identities: { id: string; provider: string; username: string | null }[];
  githubAvailable: boolean;
}

export interface Invite {
  id: string;
  role: Role;
  note: string | null;
  /** Set for a link that gives an existing user a new passkey. */
  user: { id: number; name: string } | null;
  createdBy: string | null;
  expiresAt: string;
  createdAt: string;
}

/** Answer to the creation of an invitation: its link is shown once. */
export interface CreatedInvite {
  id: string;
  url: string;
  role: Role;
  note: string | null;
  expiresAt: string;
}

/** What an invitation link shows before it is used. */
export interface InviteInfo {
  role: Role;
  note: string | null;
  user: { name: string } | null;
  expiresAt: string;
  /** False on an install without TLS, where browsers refuse passkeys. */
  passkeyRequired: boolean;
}

export interface ApiTokenInfo {
  id: string;
  name: string;
  /** spn_<prefix>_... */
  hint: string;
  scopes: Scope[];
  project: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  user?: { id: number; name: string };
}

/** Answer to the creation of a token: the token itself is shown once. */
export interface CreatedToken {
  token: string;
  info: ApiTokenInfo;
}

/** A CLI login waiting for approval (device flow). */
export interface DeviceRequest {
  userCode: string;
  clientName: string;
  expiresAt: string;
  scopes: Scope[];
}

export interface GithubSettings {
  enabled: boolean;
  source: 'settings' | 'environment' | 'none';
  clientId: string;
  hasSecret: boolean;
  org: string;
  team: string;
  callbackUrl: string;
}

export interface AuditEvent {
  id: number;
  createdAt: string;
  userId: number | null;
  /** "Ada", "Ada via claude-laptop", "bootstrap token". */
  actor: string;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
}

// Projects

export interface Project {
  id: string;
  slug: string;
  name: string;
  repoUrl: string;
  defaultRef: string;
  /** Directory holding .spawner/ in the repository ("." unless it is a monorepo). */
  rootDir: string;
  /** Exposures may be public (auth: none). */
  allowPublic: boolean;
  /** Environments may never sleep (idle: never). */
  allowAlwaysOn: boolean;
  /** Repositories the other sources of spawner.yaml may come from, besides repoUrl. */
  sourceRepos: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary extends Project {
  environmentCount: number;
}

/** A project with the names of its variables (GET /projects/:slug). */
export interface ProjectDetail extends Project {
  variables: { name: string; secret: boolean }[];
}

export interface ProjectInput {
  slug?: string;
  name?: string;
  repoUrl?: string;
  defaultRef?: string;
  rootDir?: string;
  allowPublic?: boolean;
  allowAlwaysOn?: boolean;
  sourceRepos?: string[];
}

/** A variable of the compose files of a project; secret values are never shown again. */
export interface ProjectVariable {
  name: string;
  secret: boolean;
  value: string | null;
  updatedAt: string;
}

/** spawner.yaml of a project at a ref (GET /projects/:slug/manifest). */
export interface ProjectManifest {
  ref: string;
  /** Name of the project's own source. */
  name: string | null;
  sources: { name: string; repo: string; defaultRef: string }[];
  exposures: { name: string; service: string; port: number; entrypoint: boolean; auth: string }[];
  issues: { code: string; path: string; message: string; hint?: string }[];
}

/** What a project uses, and what one of its environments typically costs. */
export interface ProjectUsage {
  environments: { total: number; byStatus: Record<string, number> };
  now: { cpuPercent: number; memoryBytes: number; diskBytes: number };
  typical: {
    memoryBytes: number;
    diskBytes: number;
    /** Measured, or the declared limits and a default before any environment ran. */
    basedOn: { memory: 'usage' | 'limits'; disk: 'usage' | 'default' };
    buildSeconds: number | null;
  };
}

// Environments

/**
 * Stable states (degraded: a service is down; sleeping: stopped after its
 * idle time, the next visit wakes it up), then the step a running job is at.
 */
export type EnvironmentStatus =
  | 'ready'
  | 'degraded'
  | 'sleeping'
  | 'stopped'
  | 'failed'
  | 'deleted'
  | 'queued'
  | 'preparing'
  | 'validating'
  | 'building'
  | 'seeding'
  | 'routing'
  | 'stopping'
  | 'starting'
  | 'waking'
  | 'deleting';

export type JobPhase =
  | 'preparing'
  | 'validating'
  | 'building'
  | 'seeding'
  | 'routing'
  | 'deleting'
  | 'stopping'
  | 'starting'
  | 'sleeping'
  | 'waking';

export type CreatedVia = 'ui' | 'cli' | 'mcp' | 'api';

export interface Exposure {
  name: string;
  service: string;
  port: number;
  host: string;
  entrypoint: boolean;
  auth: string;
}

export interface EnvironmentSource {
  name: string;
  /** The project repository itself, as opposed to the other sources of spawner.yaml. */
  primary: boolean;
  origin: 'git' | 'upload';
  repoUrl: string | null;
  ref: string | null;
  commit: string | null;
  digest: string | null;
  sizeBytes: number | null;
  /** False once its code was removed after the build, which alone needed it. */
  onDisk: boolean;
}

export interface Environment {
  id: string;
  /** Project slug. */
  project: string;
  slug: string;
  status: EnvironmentStatus;
  /** Phase where the last job failed, when status is "failed". */
  phase: JobPhase | null;
  error: string | null;
  createdVia: CreatedVia;
  owner: { id: number; name: string } | null;
  /** Token the environment was created with ("claude-laptop"). */
  tokenName: string | null;
  /** URL of the entrypoint exposure. */
  url: string | null;
  /** URL of each exposure, by name. */
  urls: Record<string, string>;
  exposures: Exposure[];
  sources: EnvironmentSource[];
  lastJob: Job | null;
  expiresAt: string | null;
  /** Last request let through to one of its URLs, or last action on it. */
  lastActivityAt: string | null;
  /** Time without activity before it sleeps; 0 when it never does. */
  idleSeconds: number;
  /** When it goes to sleep if nothing happens before (awake environments). */
  sleepsAt: string | null;
  /** CPU and memory of its running containers at the last sample (every 30 seconds). */
  usage: { cpuPercent: number; memoryBytes: number; memoryLimitBytes: number; at: string } | null;
  createdAt: string;
  updatedAt: string;
  /** Set for an environment deleted in the last 7 days, still readable. */
  deletedAt: string | null;
}

/** Where a source comes from when deploying from git: a branch, tag or commit. */
export interface SourceRef {
  ref?: string;
}

// Jobs

export type JobType = 'create' | 'update' | 'delete' | 'stop' | 'start' | 'sleep' | 'wake';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/**
 * Why a job failed, for machines: invalid (spawner.yaml, the compose file or
 * its variables refused), capacity (not enough memory to build), upload
 * (archive refused), interrupted (Spawner restarted during the job).
 */
export type JobErrorCode = 'invalid' | 'capacity' | 'upload' | 'interrupted';

export interface Job {
  id: string;
  environmentId: string;
  type: JobType;
  status: JobStatus;
  phase: JobPhase | null;
  error: string | null;
  errorCode: JobErrorCode | null;
  /** Who asked for it: "Ada via claude-laptop". */
  actor: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Answer to every request that changes an environment: the job doing it. */
export interface JobAccepted {
  environment: Environment;
  job: Job;
}

// Operations on running environments

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}

/** A compose service of an environment and the state of its container. */
export interface ServiceState {
  name: string;
  /** Docker state: running, restarting, exited... */
  state: string;
  /** As Docker words it, such as "Up 5 minutes (healthy)". */
  status: string;
  /** healthy, unhealthy or starting, for a service with a healthcheck. */
  health: string | null;
  /** Restarts by the restart policy since the container was created. */
  restartCount: number;
  /** The last stop was a kill for lack of memory. */
  oomKilled: boolean;
  /** Exit code of a stopped container. */
  exitCode: number | null;
  startedAt: string | null;
}

/** A service with its usage right now (GET /envs/:id/services?usage=true). */
export interface ServiceUsage extends ServiceState {
  cpuPercent: number | null;
  /** Memory in use, without the reclaimable page cache. */
  memoryBytes: number | null;
  memoryLimitBytes: number | null;
  /** Size of the container's writable layer. */
  diskBytes: number | null;
}

/** A line of a service's output (GET /envs/:id/logs). */
export interface LogLine {
  service: string;
  stream: 'stdout' | 'stderr';
  /** ISO 8601, to the millisecond. */
  time: string;
  text: string;
}

export interface ShareLink {
  id: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
}

/** Answer to the creation of a share link: its URL is shown once. */
export interface CreatedShareLink {
  id: string;
  url: string;
  expiresAt: string;
}

/** A token for the X-Spawner-Preview header, how agents open protected previews. */
export interface PreviewToken {
  header: string;
  token: string;
  expiresAt: string;
}

// Supervision

export type TimelineEventType = 'crash' | 'oom' | 'unhealthy' | 'healthy' | 'job_started' | 'job_succeeded' | 'job_failed' | 'extended';

/** Something that happened to an environment: a service, or a job. */
export interface TimelineEvent {
  id: string;
  time: string;
  type: TimelineEventType;
  service: string | null;
  message: string;
  details: Record<string, unknown> | null;
}

/** A service that crashed or ran out of memory at least three times in ten minutes. */
export interface CrashLoop {
  service: string;
  count: number;
  windowMinutes: number;
  /** "out of memory (limit 512 MiB)" or "exit code 1". */
  lastCause: string;
  lastAt: string;
}

export interface EnvironmentEvents {
  events: TimelineEvent[];
  crashLoops: CrashLoop[];
}

export type MetricRange = '1h' | '6h' | '24h' | '7d' | '30d';

/** A point of a chart: a minute, or an average over a longer period. */
export interface MetricPoint {
  time: string;
  cpuPercent: number;
  memoryBytes: number;
  /** Highest memory of the period, when it averages several minutes. */
  memoryMaxBytes?: number;
  memoryLimitBytes?: number | null;
  /** Each service, up to 48 hours back. */
  services?: Record<string, { cpu: number; memory: number }>;
}

export interface EnvironmentMetrics {
  range: MetricRange;
  points: MetricPoint[];
  /** Highest memory of each service over the range. */
  peaks: Record<string, number>;
  now: { cpuPercent: number; memoryBytes: number; memoryLimitBytes: number; services: Record<string, { cpuPercent: number; memoryBytes: number; memoryLimitBytes: number }>; at: string } | null;
}

/** What an environment holds on disk. */
export interface EnvironmentDisk {
  /** Layers of its built images no other image uses. */
  imagesUniqueBytes: number;
  /** Layers it shares with other images (dependencies, base images): stored once. */
  imagesSharedBytes: number;
  volumesBytes: number;
  /** Files its containers wrote outside volumes. */
  writableBytes: number;
  sourcesBytes: number;
  /** What it adds to the disk: everything but the shared layers. */
  totalBytes: number;
}

export interface DiskBreakdown {
  imagesBytes: number;
  buildCacheBytes: number;
  volumesBytes: number;
  writableBytes: number;
  sourcesBytes: number;
  logsBytes: number;
  spawnerBytes: number;
  environments: Record<string, EnvironmentDisk>;
}

export interface DiskSnapshot {
  time: string;
  totalBytes: number;
  freeBytes: number;
  details: DiskBreakdown;
}

export interface HostSnapshot {
  cpus: number;
  cpuModel: string | null;
  cpuPercent: number | null;
  load: [number, number, number];
  memory: { totalBytes: number; availableBytes: number; cacheBytes: number; swapTotalBytes: number; swapUsedBytes: number };
  disk: { path: string; totalBytes: number; freeBytes: number };
  uptimeSeconds: number;
}

export interface ContainerUsage {
  name: string;
  image: string;
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
}

export interface SystemAlert {
  level: 'warning' | 'critical';
  kind: 'disk' | 'memory' | 'crash_loop' | 'oom';
  message: string;
  environmentId?: string;
}

/** The host now (GET /api/v1/system, admins). */
export interface SystemOverview {
  at: string | null;
  host: HostSnapshot | null;
  usage: {
    environments: { count: number; cpuPercent: number; memoryBytes: number };
    spawner: { cpuPercent: number; memoryBytes: number; containers: ContainerUsage[] };
    others: { cpuPercent: number; memoryBytes: number; containers: ContainerUsage[] };
  } | null;
  disk: DiskSnapshot | null;
  alerts: SystemAlert[];
  projects: { slug: string; name: string; environments: number; running: number; cpuPercent: number; memoryBytes: number; diskBytes: number }[];
}

export interface SystemMetrics {
  range: MetricRange;
  points: {
    time: string;
    cpuPercent: number;
    /** Memory the host uses (total minus available). */
    memoryBytes: number;
    memoryTotalBytes: number | null;
    environments: number;
    spawner: number;
    others: number;
  }[];
}

/** Room for more environments of each project (GET /api/v1/system/capacity). */
export interface Capacity {
  host: {
    availableMemoryBytes: number;
    freeDiskBytes: number;
    reserves: { memoryBytes: number; diskBytes: number };
    /** What a build waits for before it starts (null: not checked); the places count it. */
    buildGuards?: { memoryBytes: number | null; diskBytes: number | null };
  } | null;
  /** The environments the reader may still create; null without a user or a limit. */
  quota: { limit: number; used: number; remaining: number } | null;
  projects: {
    project: string;
    name: string;
    /** Typical memory and disk of one of its environments. */
    memoryBytes: number;
    diskBytes: number;
    basedOn: { memory: 'usage' | 'limits'; disk: 'usage' | 'default' };
    /** null until the first sample of the host. */
    places: number | null;
    byMemory?: number;
    byDisk?: number;
    byQuota?: number | null;
    limitedBy?: 'memory' | 'disk' | 'quota';
  }[];
}

/**
 * Lifetimes, sleep, quotas, memory and build guards (GET and PUT
 * /api/v1/settings/limits). Durations in seconds, sizes in bytes; 0 turns
 * sleeping, the quota or a guard off.
 */
export interface Limits {
  ttlSeconds: number;
  ttlMaxSeconds: number;
  idleSeconds: number;
  envsPerUser: number;
  envMemoryBytes: number;
  envMemoryMaxBytes: number;
  buildMinFreeMemoryBytes: number;
  buildMinFreeDiskBytes: number;
}

export interface LimitsView {
  values: Limits;
  /** What the environment of the server sets. */
  defaults: Limits;
  /** The limits an admin changed. */
  overridden: (keyof Limits)[];
}

/** Something Spawner owns and no longer needs (GET /api/v1/system/cleanup). */
export interface CleanupItem {
  kind: 'container' | 'volume' | 'network' | 'image' | 'routes' | 'directory' | 'upload' | 'mirror';
  id: string;
  name: string;
  sizeBytes: number | null;
  reason: string;
  /** Removed every minute anyway; the others wait for an admin. */
  automatic: boolean;
}

export interface CleanupScan {
  items: CleanupItem[];
  totalBytes: number;
}

export interface CleanupResult {
  removed: CleanupItem[];
  failed: (CleanupItem & { error: string })[];
  freedBytes: number;
}

/** A terminal opened in a service, and its recording (admins). */
export interface TerminalSessionInfo {
  id: string;
  environmentId: string | null;
  environment: string;
  service: string;
  actor: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  exitCode: number | null;
  recordedBytes: number;
  truncated: boolean;
}

// Git

export interface GitKeyInfo {
  exists: boolean;
  publicKey: string | null;
}

export interface GitTestResult {
  ok: boolean;
  message: string;
}

export interface RepoKeyInfo {
  gitRepo: string;
  keyExists: boolean;
  publicKey?: string;
  /** Projects ("app") and manifest sources ("app/front") cloning this repository. */
  usedBy: string[];
}

/** A version of Spawner this server may update to (GET /api/v1/system/update). */
export interface UpdateRelease {
  version: string;
  name: string;
  /** Release notes. */
  url: string | null;
  publishedAt: string | null;
  prerelease: boolean;
}

/** An update started from the dashboard, and how it went. */
export interface UpdateRun {
  from: string;
  to: string;
  /** Who started it. */
  by: string;
  startedAt: string;
  finishedAt: string | null;
  state: 'running' | 'succeeded' | 'failed';
  /** While running: downloading the new image, then installing it (Spawner restarts). */
  phase: 'downloading' | 'installing' | null;
  error: string | null;
  /** The end of the installer's output. */
  log: string[];
}

/** Whether a newer Spawner exists, and whether this server can update itself (GET /api/v1/system/update). */
export interface UpdateStatus {
  current: string;
  /** False when Spawner was not installed by install.sh from a release image: `reason` says how to update it. */
  managed: boolean;
  reason: string | null;
  /** Whether Spawner checks for new versions by itself (SPAWNER_UPDATE_CHECK). */
  automaticChecks: boolean;
  checkedAt: string | null;
  checkError: string | null;
  /** The newest version this server may move to, when there is one. */
  latest: UpdateRelease | null;
  run: UpdateRun | null;
}
