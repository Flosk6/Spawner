import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import axios from 'axios';
import type {
  Account,
  ApiTokenInfo,
  AuditEvent,
  AuthSession,
  CreatedInvite,
  CreatedShareLink,
  CreatedToken,
  DeviceRequest,
  Environment,
  ExecResult,
  GitKeyInfo,
  GitTestResult,
  GithubSettings,
  Invite,
  InviteInfo,
  Job,
  JobAccepted,
  PreviewToken,
  Project,
  ProjectInput,
  ProjectSummary,
  RepoKeyInfo,
  Role,
  Scope,
  ServiceState,
  ShareLink,
  TeamMember,
  UsagePoint,
  User,
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

export const authApi = {
  session: () => api.get<AuthSession>('/v1/auth/session').then((res) => res.data),
  logout: () => api.post('/v1/auth/logout').then(() => undefined),
  passkeyOptions: () => api.post<PublicKeyCredentialRequestOptionsJSON>('/v1/auth/passkey/options').then((res) => res.data),
  passkeyLogin: (credential: unknown) => api.post<{ user: User }>('/v1/auth/passkey', { credential }).then((res) => res.data),
  /** Where the browser goes to log in with GitHub, or to link GitHub to the account. */
  githubUrl: (options: { next?: string; link?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (options.next) {
      params.set('next', options.next);
    }
    if (options.link) {
      params.set('link', 'true');
    }
    const query = params.toString();
    return `/api/v1/auth/github${query ? `?${query}` : ''}`;
  },
  wsTicket: () => api.post<{ ticket: string; expiresAt: number }>('/v1/auth/ws-ticket').then((res) => res.data),
};

export const invitesApi = {
  open: (token: string) => api.get<InviteInfo>(`/v1/invites/open/${token}`).then((res) => res.data),
  passkeyOptions: (token: string, name: string) =>
    api.post<PublicKeyCredentialCreationOptionsJSON>(`/v1/invites/open/${token}/passkey-options`, { name }).then((res) => res.data),
  accept: (token: string, body: { name?: string; credential?: unknown; passkeyName?: string }) =>
    api.post<{ user: User }>(`/v1/invites/open/${token}/accept`, body).then((res) => res.data),
  list: () => api.get<Invite[]>('/v1/invites').then((res) => res.data),
  create: (body: { role?: Role; note?: string; ttlHours?: number; userId?: number }) => api.post<CreatedInvite>('/v1/invites', body).then((res) => res.data),
  revoke: (id: string) => api.delete(`/v1/invites/${id}`).then(() => undefined),
};

export const usersApi = {
  list: () => api.get<TeamMember[]>('/v1/users').then((res) => res.data),
  update: (id: number, body: { role?: Role; isActive?: boolean }) => api.patch<TeamMember>(`/v1/users/${id}`, body).then((res) => res.data),
};

export const meApi = {
  get: () => api.get<Account>('/v1/me').then((res) => res.data),
  rename: (name: string) => api.patch<User>('/v1/me', { name }).then((res) => res.data),
  passkeyOptions: () => api.post<PublicKeyCredentialCreationOptionsJSON>('/v1/me/passkeys/options').then((res) => res.data),
  addPasskey: (credential: unknown, name: string) => api.post('/v1/me/passkeys', { credential, name }).then((res) => res.data),
  removePasskey: (id: string) => api.delete(`/v1/me/passkeys/${encodeURIComponent(id)}`).then(() => undefined),
  removeIdentity: (id: string) => api.delete(`/v1/me/identities/${id}`).then(() => undefined),
};

export const tokensApi = {
  list: (everyone = false) => api.get<ApiTokenInfo[]>('/v1/tokens', { params: everyone ? { all: 'true' } : {} }).then((res) => res.data),
  create: (body: { name: string; scopes: Scope[]; expiresInDays: number; project?: string }) => api.post<CreatedToken>('/v1/tokens', body).then((res) => res.data),
  revoke: (id: string) => api.delete(`/v1/tokens/${id}`).then(() => undefined),
};

export const deviceApi = {
  describe: (userCode: string) => api.get<DeviceRequest>(`/v1/auth/device/${encodeURIComponent(userCode)}`).then((res) => res.data),
  decide: (userCode: string, approve: boolean) => api.post<{ status: string }>('/v1/auth/device/approve', { userCode, approve }).then((res) => res.data),
};

export const settingsApi = {
  github: () => api.get<GithubSettings>('/v1/settings/github').then((res) => res.data),
  updateGithub: (body: { enabled: boolean; clientId: string; clientSecret?: string; org: string; team: string }) =>
    api.put<GithubSettings>('/v1/settings/github', body).then((res) => res.data),
};

export const auditApi = {
  list: (options: { before?: number; action?: string } = {}) => api.get<AuditEvent[]>('/v1/audit', { params: { limit: 50, ...options } }).then((res) => res.data),
};

export const systemApi = {
  hostStats: <T>() => api.get<{ data: T }>('/v1/system/host/stats').then((res) => res.data.data),
  environmentsStats: <T>() => api.get<{ data: T }>('/v1/system/spawner/environments-stats').then((res) => res.data.data),
};

export const projectsApi = {
  list: () => api.get<ProjectSummary[]>('/v1/projects').then((res) => res.data),
  branches: (slug: string) => api.get<{ branches: string[] }>(`/v1/projects/${slug}/branches`).then((res) => res.data.branches),
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
  list: (filter: { project?: string; mine?: boolean } = {}) =>
    api.get<Environment[]>('/v1/envs', { params: { project: filter.project, mine: filter.mine ? 'true' : undefined } }).then((res) => res.data),
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
  share: (id: string, ttlHours: number) => api.post<CreatedShareLink>(`/v1/envs/${id}/share`, { ttlHours }).then((res) => res.data),
  shares: (id: string) => api.get<ShareLink[]>(`/v1/envs/${id}/shares`).then((res) => res.data),
  revokeShare: (id: string, shareId: string) => api.delete(`/v1/envs/${id}/shares/${shareId}`).then(() => undefined),
  previewToken: (id: string) => api.post<PreviewToken>(`/v1/envs/${id}/preview-token`).then((res) => res.data),
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
  getKey: () => api.get<GitKeyInfo>('/v1/git/key').then((res) => res.data),
  generateKey: () => api.post<GitKeyInfo>('/v1/git/key/generate').then((res) => res.data),
  testConnection: (gitRepo: string) => api.post<GitTestResult>('/v1/git/test', { gitRepo }).then((res) => res.data),
  repos: () => api.get<RepoKeyInfo[]>('/v1/git/keys/repos').then((res) => res.data),
  generateRepoKey: (gitRepo: string) =>
    api.post<{ publicKey: string; privateKeyPath: string }>('/v1/git/keys/generate', { gitRepo }).then((res) => res.data),
};

export default api;
