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
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary extends Project {
  environmentCount: number;
}

export interface ProjectInput {
  slug?: string;
  name?: string;
  repoUrl?: string;
  defaultRef?: string;
  rootDir?: string;
}

// Environments

/** Stable states, then the step a running job is at. */
export type EnvironmentStatus =
  | 'ready'
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
  | 'deleting';

export type JobPhase = 'preparing' | 'validating' | 'building' | 'seeding' | 'routing' | 'deleting' | 'stopping' | 'starting';

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
  /** Last request let through to one of its URLs. */
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Where a source comes from when deploying from git: a branch, tag or commit. */
export interface SourceRef {
  ref?: string;
}

// Jobs

export type JobType = 'create' | 'update' | 'delete' | 'stop' | 'start';

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

export interface UsagePoint {
  time: string;
  cpuPercent: number;
  memoryUsageGB: number;
  memoryLimitGB: number;
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
