// Bundles the CLI into one CommonJS file, dist/spawner.cjs, that runs on
// Node.js 20 or later without node_modules: what the server serves for
// download (saved as "spawner", without extension, so CommonJS) and what npm
// publishes as spawner-cli.
import { build } from 'esbuild';
import { chmodSync, readFileSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';

// The release build sets SPAWNER_VERSION from its tag (2.0.0-rc.1).
const version = process.env.SPAWNER_VERSION || JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

rmSync(new URL('./dist', import.meta.url), { recursive: true, force: true });
await build({
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: ['src/main.ts'],
  outfile: 'dist/spawner.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  banner: { js: '#!/usr/bin/env node' },
  define: { __SPAWNER_CLI_VERSION__: JSON.stringify(version) },
  // The MCP SDK brings three variants of zod: minified, the file is about half the size.
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});
chmodSync(new URL('./dist/spawner.cjs', import.meta.url), 0o755);
