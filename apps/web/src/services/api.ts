import axios from 'axios';
import type { ProjectConfig, Environment, EnvironmentDetail, GitKeyInfo, GitTestResult } from '../types';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

export const projectApi = {
  getProject: () => api.get<ProjectConfig>('/project').then(res => res.data),
};

export const gitApi = {
  getKey: () => api.get<GitKeyInfo>('/git/key').then(res => res.data),
  generateKey: () => api.post<GitKeyInfo>('/git/key/generate').then(res => res.data),
  testConnection: (resourceName: string) =>
    api.post<GitTestResult>('/git/test', { resourceName }).then(res => res.data),
};

export const environmentApi = {
  getAll: () => api.get<Environment[]>('/environments').then(res => res.data),
  getOne: (id: string) => api.get<EnvironmentDetail>(`/environments/${id}`).then(res => res.data),
  create: (name: string, branches: Record<string, string>) =>
    api.post<Environment>('/environments', { name, branches }).then(res => res.data),
  delete: (id: string) => api.delete(`/environments/${id}`).then(res => res.data),
  getLogs: (id: string, resourceName: string) =>
    api.get<{ logs: string }>(`/environments/${id}/logs/${resourceName}`).then(res => res.data),
  execCommand: (id: string, resourceName: string, command: string) =>
    api.post<{ success: boolean; output: string; error?: string; stdout: string; stderr: string }>(`/environments/${id}/exec/${resourceName}`, { command }).then(res => res.data),
  streamLogs: (id: string, resourceName: string) =>
    api.get<{ containerName: string; command: string }>(`/environments/${id}/logs-stream/${resourceName}`).then(res => res.data),
};

// Export default pour pouvoir faire: import api from '../services/api'
export default api;
