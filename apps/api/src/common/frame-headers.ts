import type { NextFunction, Request, Response } from "express";

/**
 * Headers that keep every page of Spawner out of frames: frame-ancestors
 * for current browsers, X-Frame-Options for older ones.
 */
export const FRAME_HEADERS: Readonly<Record<string, string>> = {
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

/**
 * Express middleware that forbids framing on every response of the API
 * process: the dashboard, its static files and the API itself. Previews run
 * on sibling hosts of the dashboard, on the same site, so the session cookie
 * reaches a dashboard framed by a hostile branch, which could then steer a
 * visitor's click (approve a CLI login, change a role).
 *
 * Register it before the web app's static files, which are answered without
 * reaching later middleware. A handler that sets its own
 * Content-Security-Policy replaces this one and must keep
 * frame-ancestors 'none' in it, as the waiting page of previews does.
 * forwardAuth answers carry these headers too: Traefik copies none of them
 * onto a request it lets through, and a refusal or redirect it hands back to
 * the browser is not a page to frame.
 */
export function frameHeaders(_request: Request, response: Response, next: NextFunction): void {
  for (const [name, value] of Object.entries(FRAME_HEADERS)) {
    response.setHeader(name, value);
  }
  next();
}
