import axios from "axios";
import type {
  ProjectConfig,
  Environment,
  EnvironmentDetail,
  GitKeyInfo,
  GitTestResult,
} from "../types";

const api = axios.create({
  baseURL: "/api",
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
});

export const projectApi = {
  getProject: () => api.get<ProjectConfig>("/project").then((res) => res.data),
};

export const gitApi = {
  getKey: () => api.get<GitKeyInfo>("/git/key").then((res) => res.data),
  generateKey: () =>
    api.post<GitKeyInfo>("/git/key/generate").then((res) => res.data),
  testConnection: (resourceName: string) =>
    api
      .post<GitTestResult>("/git/test", { resourceName })
      .then((res) => res.data),
};

export const environmentApi = {
  getAll: () => api.get<Environment[]>("/environments").then((res) => res.data),
  getOne: (id: string) =>
    api.get<EnvironmentDetail>(`/environments/${id}`).then((res) => res.data),
  create: (name: string, branches: Record<string, string>) =>
    api
      .post<Environment>("/environments", { name, branches })
      .then((res) => res.data),
  delete: (id: string) =>
    api.delete(`/environments/${id}`).then((res) => res.data),
  getLogs: (id: string, resourceName: string) =>
    api
      .get<{ logs: string }>(`/environments/${id}/logs/${resourceName}`)
      .then((res) => res.data),
  execCommand: (id: string, resourceName: string, command: string) =>
    api
      .post<{
        success: boolean;
        output: string;
        error?: string;
        stdout: string;
        stderr: string;
      }>(`/environments/${id}/exec/${resourceName}`, { command })
      .then((res) => res.data),
  streamLogs: (id: string, resourceName: string) =>
    api
      .get<{
        containerName: string;
        command: string;
      }>(`/environments/${id}/logs-stream/${resourceName}`)
      .then((res) => res.data),
  pause: (id: string) =>
    api
      .post<EnvironmentDetail>(`/environments/${id}/pause`)
      .then((res) => res.data),
  resume: (id: string) =>
    api
      .post<EnvironmentDetail>(`/environments/${id}/resume`)
      .then((res) => res.data),
  restart: (id: string) =>
    api
      .post<EnvironmentDetail>(`/environments/${id}/restart`)
      .then((res) => res.data),
  update: (id: string, branches?: Record<string, string>) =>
    api
      .post<EnvironmentDetail>(`/environments/${id}/update`, { branches })
      .then((res) => res.data),
  restartResource: (id: string, resourceName: string) =>
    api
      .post<{
        success: boolean;
        message: string;
      }>(`/environments/${id}/resources/${resourceName}/restart`)
      .then((res) => res.data),
  getBuildLogs: (id: string) =>
    api
      .get<{
        environmentId: string;
        logs: Array<{
          environmentId: string;
          timestamp: string;
          level: 'info' | 'success' | 'warning' | 'error';
          message: string;
          step?: string;
        }>;
        count: number;
      }>(`/environments/${id}/build-logs`)
      .then((res) => res.data),
};

export default api;
