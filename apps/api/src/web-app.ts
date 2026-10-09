import { NestExpressApplication } from '@nestjs/platform-express';
import { createHash } from 'crypto';
import { join, sep } from 'path';
import { existsSync, readFileSync } from 'fs';
import type { Request, Response, NextFunction } from 'express';

const BACKEND_PREFIXES = ['/api', '/socket.io'];

/**
 * Tells whether a request path belongs to the backend (REST API or Socket.IO)
 * rather than to the single-page app. Only exact prefixes count: "/apiary"
 * is a web route, "/api/projects" is not.
 */
export function isBackendPath(path: string): boolean {
  return BACKEND_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * The Content-Security-Policy of the dashboard's page: its own scripts and
 * the inline ones of index.html by their hashes (the theme applied before
 * the first paint), the styles PrimeVue injects, GitHub avatars, its own
 * API and terminal, and never a frame. A script a branch would manage to
 * slip into the page runs nowhere.
 */
export function dashboardPolicy(indexHtml: string): string {
  const inline = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (match) => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`,
  );
  return [
    "default-src 'self'",
    ["script-src 'self'", ...inline].join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://avatars.githubusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Serves the built web interface from WEB_DIST_PATH, so a single container
 * exposes the API (/api, /socket.io) and the single-page app on one origin.
 * Hashed assets are cached for a year; index.html is never cached, so a new
 * release is picked up on the next page load, with the dashboard's policy
 * (dashboardPolicy). Must be registered before the session middleware so
 * static files never trigger a session store lookup.
 */
export function serveWebApp(app: NestExpressApplication) {
  const webDist = process.env.WEB_DIST_PATH;
  if (!webDist) {
    return;
  }

  const indexHtml = join(webDist, 'index.html');
  if (!existsSync(indexHtml)) {
    console.warn(`WEB_DIST_PATH is set but ${indexHtml} is missing, web interface disabled`);
    return;
  }

  const policy = dashboardPolicy(readFileSync(indexHtml, 'utf8'));
  app.useStaticAssets(webDist, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${sep}assets${sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!['GET', 'HEAD'].includes(req.method) || isBackendPath(req.path)) {
      return next();
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Security-Policy', policy);
    res.sendFile('index.html', { root: webDist });
  });
}
