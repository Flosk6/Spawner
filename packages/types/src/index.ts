// Shapes returned by the Spawner API, shared by the web UI and the CLI.
// Dates are ISO 8601 strings once they went through JSON.

// Authentication

export type UserRole = 'user' | 'admin';

export interface User {
  id: number;
  githubId: string;
  username: string;
  email?: string;
  avatarUrl?: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthStatus {
  authenticated: boolean;
  user: User | null;
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
  ownerId: number | null;
  /** URL of the entrypoint exposure. */
  url: string | null;
  /** URL of each exposure, by name. */
  urls: Record<string, string>;
  exposures: Exposure[];
  sources: EnvironmentSource[];
  lastJob: Job | null;
  expiresAt: string | null;
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

export interface Job {
  id: string;
  environmentId: string;
  type: JobType;
  status: JobStatus;
  phase: JobPhase | null;
  error: string | null;
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
