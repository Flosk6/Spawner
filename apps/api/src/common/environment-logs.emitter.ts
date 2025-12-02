import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export interface EnvironmentLog {
  environmentId: string;
  timestamp: Date;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  step?: string;
}

@Injectable()
export class EnvironmentLogsEmitter extends EventEmitter {
  private logs: Map<string, EnvironmentLog[]> = new Map();
  private readonly MAX_LOGS_PER_ENV = 1000;
  private readonly LOG_RETENTION_MS = 24 * 60 * 60 * 1000;

  constructor() {
    super();
    setInterval(() => this.cleanupOldLogs(), 60 * 60 * 1000);
  }

  emitLog(environmentId: string, level: EnvironmentLog['level'], message: string, step?: string) {
    const log: EnvironmentLog = {
      environmentId,
      timestamp: new Date(),
      level,
      message,
      step,
    };

    if (!this.logs.has(environmentId)) {
      this.logs.set(environmentId, []);
    }

    const envLogs = this.logs.get(environmentId)!;
    envLogs.push(log);

    if (envLogs.length > this.MAX_LOGS_PER_ENV) {
      envLogs.shift();
    }

    this.emit(`logs:${environmentId}`, log);
  }

  private cleanupOldLogs() {
    const now = Date.now();
    for (const [environmentId, logs] of this.logs.entries()) {
      const filteredLogs = logs.filter(
        (log) => now - log.timestamp.getTime() < this.LOG_RETENTION_MS
      );

      if (filteredLogs.length === 0) {
        this.logs.delete(environmentId);
      } else {
        this.logs.set(environmentId, filteredLogs);
      }
    }
  }

  getLogs(environmentId: string): EnvironmentLog[] {
    return this.logs.get(environmentId) || [];
  }

  clearLogs(environmentId: string) {
    this.logs.delete(environmentId);
  }

  info(environmentId: string, message: string, step?: string) {
    this.emitLog(environmentId, 'info', message, step);
  }

  success(environmentId: string, message: string, step?: string) {
    this.emitLog(environmentId, 'success', message, step);
  }

  warning(environmentId: string, message: string, step?: string) {
    this.emitLog(environmentId, 'warning', message, step);
  }

  error(environmentId: string, message: string, step?: string) {
    this.emitLog(environmentId, 'error', message, step);
  }
}
