import axios from 'axios';
import type {
  Environment,
  ExecResult,
  GitKeyInfo,
  GitTestResult,
  Job,
  JobAccepted,
  Project,
  ProjectInput,
  ProjectSummary,
  RepoKeyInfo,
  ServiceState,
  UsagePoint,
} from '../types';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  // The API refuses changes carried by the session cookie alone: a page on
  // another origin cannot send this header.
  headers: { 'X-Spawner-Client': 'web' },
});

/** The message of an API error, for a toast or a form. */
export function errorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;
    if (Array.isArray(message)) {
      return message.join(', ');
    }
    if (typeof message === 'string') {
      return message;
    }
  }
  return fallback;
}

export const projectsApi = {
  list: () => api.get<ProjectSummary[]>('/v1/projects').then((res) => res.data),
  get: (slug: string) => api.get<Project>(`/v1/projects/${slug}`).then((res) => res.data),
  create: (input: ProjectInput) => api.post<Project>('/v1/projects', input).then((res) => res.data),
  update: (slug: string, input: ProjectInput) => api.patch<Project>(`/v1/projects/${slug}`, input).then((res) => res.data),
  remove: (slug: string) => api.delete(`/v1/projects/${slug}`).then(() => undefined),
};

/**
 * What to deploy from git: a branch, tag or commit of the project repository
 * (its default branch when empty) and of the other sources of spawner.yaml
 * (their default from the manifest when absent).
 */
export interface GitDeploy {
  ref?: string;
  sources?: Record<string, string>;
}

function deployForm(deploy: GitDeploy, fields: Record<string, string>): FormData {
  const form = new FormData();
  Object.entries(fields).forEach(([name, value]) => form.append(name, value));
  if (deploy.ref) {
    form.append('primary', JSON.stringify({ ref: deploy.ref }));
  }
  const sources = Object.entries(deploy.sources ?? {}).filter(([, ref]) => ref);
  if (sources.length > 0) {
    form.append('sources', JSON.stringify(Object.fromEntries(sources.map(([name, ref]) => [name, { ref }]))));
  }
  return form;
}

export const environmentsApi = {
  list: (project?: string) => api.get<Environment[]>('/v1/envs', { params: { project } }).then((res) => res.data),
  get: (id: string) => api.get<Environment>(`/v1/envs/${id}`).then((res) => res.data),
  create: (project: string, env: string, deploy: GitDeploy) =>
    api.post<JobAccepted>('/v1/envs', deployForm(deploy, { project, env, createdVia: 'ui' })).then((res) => res.data),
  /** Redeploys; fresh drops the containers and volumes first, reseed replays the seed. */
  update: (id: string, deploy: GitDeploy, options: { fresh?: boolean; reseed?: boolean } = {}) =>
    api
      .post<JobAccepted>(
        `/v1/envs/${id}/update`,
        deployForm(deploy, { ...(options.fresh ? { fresh: 'true' } : {}), ...(options.reseed ? { reseed: 'true' } : {}) }),
      )
      .then((res) => res.data),
  remove: (id: string) => api.delete<JobAccepted>(`/v1/envs/${id}`).then((res) => res.data),
  stop: (id: string) => api.post<JobAccepted>(`/v1/envs/${id}/stop`).then((res) => res.data),
  start: (id: string) => api.post<JobAccepted>(`/v1/envs/${id}/start`).then((res) => res.data),
  services: (id: string) => api.get<ServiceState[]>(`/v1/envs/${id}/services`).then((res) => res.data),
  logs: (id: string, service: string, tail = 300) =>
    api.get<string>(`/v1/envs/${id}/logs/${service}`, { params: { tail }, responseType: 'text' }).then((res) => res.data),
  exec: (id: string, service: string, argv: string[]) =>
    api.post<ExecResult>(`/v1/envs/${id}/exec`, { service, argv }).then((res) => res.data),
  usage: (id: string, minutes = 60) => api.get<UsagePoint[]>(`/v1/envs/${id}/stats`, { params: { minutes } }).then((res) => res.data),
};

export const jobsApi = {
  get: (id: string) => api.get<Job>(`/v1/jobs/${id}`).then((res) => res.data),
  logs: (id: string) => api.get<string>(`/v1/jobs/${id}/logs`, { responseType: 'text' }).then((res) => res.data),
  /**
   * Follows a job log: onLine receives what was written so far, then each
   * new line; onEnd runs once the job is over or the stream is lost.
   * Returns a function that stops following.
   */
  follow(id: string, onLine: (line: string) => void, onEnd: () => void): () => void {
    const source = new EventSource(`/api/v1/jobs/${id}/logs/stream`);
    source.onmessage = (event) => onLine(event.data);
    // The server closes the stream when the job ends; EventSource would
    // reconnect and replay the log, so stop here.
    source.onerror = () => {
      source.close();
      onEnd();
    };
    return () => source.close();
  },
};

export const gitApi = {
  getKey: () => api.get<GitKeyInfo>('/git/key').then((res) => res.data),
  generateKey: () => api.post<GitKeyInfo>('/git/key/generate').then((res) => res.data),
  testConnection: (gitRepo: string) => api.post<GitTestResult>('/git/test', { gitRepo }).then((res) => res.data),
  branches: (gitRepo: string) => api.post<{ branches: string[] }>('/git/branches', { gitRepo }).then((res) => res.data.branches),
  repos: () => api.get<RepoKeyInfo[]>('/git/keys/repos').then((res) => res.data),
  generateRepoKey: (gitRepo: string) =>
    api.post<{ publicKey: string; privateKeyPath: string }>('/git/keys/generate', { gitRepo }).then((res) => res.data),
};

export default api;
