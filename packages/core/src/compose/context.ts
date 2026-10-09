const MiB = 1024 ** 2;
const GiB = 1024 ** 3;

/**
 * Resource rules applied to every environment. Admins can tune them; the
 * defaults match the v1 specification.
 */
export interface ComposeLimits {
  envMemoryBytes: number;
  /** CPUs of the whole environment, shared like its memory. */
  envCpus: number;
  /** Processes of the whole environment, shared like its memory. */
  envPids: number;
  serviceMemoryDefaultBytes: number;
  minServiceMemoryBytes: number;
  cpusDefault: number;
  cpusMax: number;
  pidsDefault: number;
  pidsMax: number;
  shmMaxBytes: number;
  stopGraceMaxSeconds: number;
  maxServices: number;
}

export const DEFAULT_COMPOSE_LIMITS: ComposeLimits = {
  envMemoryBytes: 2 * GiB,
  envCpus: 4,
  envPids: 4096,
  serviceMemoryDefaultBytes: 512 * MiB,
  minServiceMemoryBytes: 32 * MiB,
  cpusDefault: 1,
  cpusMax: 2,
  pidsDefault: 512,
  pidsMax: 2048,
  shmMaxBytes: 1 * GiB,
  stopGraceMaxSeconds: 60,
  maxServices: 30,
};

/**
 * Everything the compose pipeline needs to know about the environment.
 *
 * composeDir is the directory of the compose file (relative paths are resolved
 * from it, as Compose does) and sourceRoots maps each source name to its
 * checkout on disk: no path in the file may resolve outside of them.
 */
export interface ComposeContext {
  project: string;
  env: string;
  envId: string;
  composeDir: string;
  sourceRoots: Record<string, string>;
  exposures: { name: string; service: string }[];
  seedServices: string[];
  limits?: Partial<ComposeLimits>;
  realpath?: (path: string) => string | null;
}

/**
 * Compose project name of an environment. The double dash cannot appear in a
 * project or environment name, so two environments never share a name.
 */
export function composeProjectName(project: string, env: string): string {
  return `spn-${project}--${env}`;
}
