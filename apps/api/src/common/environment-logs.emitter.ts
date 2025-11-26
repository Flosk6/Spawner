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

  emitLog(environmentId: string, level: EnvironmentLog['level'], message: string, step?: string) {
    const log: EnvironmentLog = {
      environmentId,
      timestamp: new Date(),
      level,
      message,
      step,
    };

    // Store log
    if (!this.logs.has(environmentId)) {
      this.logs.set(environmentId, []);
    }
    this.logs.get(environmentId).push(log);

    // Emit event
    this.emit(`logs:${environmentId}`, log);
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
