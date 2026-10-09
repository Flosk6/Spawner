import { AsyncLocalStorage } from "async_hooks";
import type { NextFunction, Request, Response } from "express";

/** Who sent the request being served: what the audit trail records of it. */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * The client of the request whose work is running, or undefined outside a
 * request (jobs, timers).
 */
export function requestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Express middleware: runs the rest of the request in its context, so that
 * what it causes knows its client without the request passed along.
 * Register it after "trust proxy", which decides request.ip.
 */
export function withRequestContext(request: Request, _response: Response, next: NextFunction): void {
  storage.run({ ip: request.ip ?? null, userAgent: request.headers["user-agent"] ?? null }, next);
}
