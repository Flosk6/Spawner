import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * A temporary directory (its real path: macOS puts tmp behind a symlink).
 */
export function tempDir(prefix = "spawner-cli-"): string {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function write(root: string, file: string, content = ""): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });
}

/**
 * A git repository on branch main with the files committed.
 */
export function repo(files: Record<string, string>): string {
  const root = tempDir();
  git(root, "init", "-q", "-b", "main");
  for (const [file, content] of Object.entries(files)) {
    write(root, file, content);
  }
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

export const MANIFEST = `version: 1
project: example
exposures:
  - name: web
    service: app
    port: 3000
seed:
  - service: app
    run: [node, seed.js]
`;

export const COMPOSE = `services:
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_PASSWORD: app
    volumes:
      - db-data:/var/lib/postgresql
  app:
    build: ..
    environment:
      PUBLIC_URL: \${SPAWNER_URL}
volumes:
  db-data:
`;
