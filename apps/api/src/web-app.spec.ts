import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as fs from 'fs';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isBackendPath, serveWebApp } from './web-app';

describe('isBackendPath', () => {
  it.each(['/api', '/api/projects', '/api/auth/status', '/socket.io', '/socket.io/'])(
    'routes %s to the backend',
    (path) => {
      expect(isBackendPath(path)).toBe(true);
    },
  );

  it.each(['/', '/projects/12', '/apiary', '/api-docs', '/socket.iox', '/environments/api'])(
    'serves %s from the web app',
    (path) => {
      expect(isBackendPath(path)).toBe(false);
    },
  );
});

@Module({})
class EmptyModule {}

describe('serveWebApp', () => {
  let app: NestExpressApplication;
  let base: string;

  beforeAll(async () => {
    const web = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'spawner-web-')), '.hidden', 'web');
    fs.mkdirSync(path.join(web, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>Spawner</title>');
    fs.writeFileSync(path.join(web, 'assets', 'app.js'), 'console.log(1)');
    vi.stubEnv('WEB_DIST_PATH', web);
    app = await NestFactory.create<NestExpressApplication>(EmptyModule, { logger: false });
    serveWebApp(app);
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await app.close();
  });

  it('serves the app and its assets from a directory whose path holds a hidden one', async () => {
    const page = await fetch(`${base}/environments/abc`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>Spawner</title>');
    expect((await fetch(`${base}/assets/app.js`)).status).toBe(200);
    expect((await fetch(`${base}/api/v1/nothing`)).status).toBe(404);
  });
});
