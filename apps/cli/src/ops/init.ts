import * as fs from "fs";
import * as path from "path";
import { parseManifest, slugIssue, SLUG_MAX_LENGTH } from "@spawner/core";
import { CliError, usageError } from "../errors";
import { gitTopLevel } from "../git";

export type Database = "postgres" | "mysql" | "none";

export interface InitOptions {
  /** Directory of the project (the current one by default). */
  dir: string;
  project?: string;
  port?: number;
  db?: Database;
  /** File that gets the instructions for coding agents, or null for none. */
  agentsFile?: string | null;
  force?: boolean;
}

/** What `spawner init --json` prints. */
export interface InitResult {
  project: string;
  files: string[];
  agentsFile: string | null;
  warnings: string[];
}

/** Heading of the instructions for coding agents; present means already added. */
export const AGENTS_HEADING = "## Preview environments (Spawner)";

/**
 * The reference of spawner.yaml, written into every manifest `init` creates:
 * the documentation site, which follows the latest release, rather than a
 * branch of the repository that may fall behind or disappear.
 */
export const MANIFEST_DOCS = "https://spawner.run/docs/manifest/";

/**
 * The instructions `spawner init` adds to CLAUDE.md or AGENTS.md, so that a
 * coding agent knows how to test its work on a preview environment.
 */
export function agentInstructions(db: Database): string {
  const database = db === "none" ? "a service" : "the database";
  return `${AGENTS_HEADING}

This project runs preview environments on Spawner: one per branch, with its own URLs and database.

- To test end to end, run \`spawner up --wait --json\` from the worktree root. It creates or updates the
  environment of the current branch and prints its name and URLs. Add \`--source <name>=<path>\` to send
  another repository of spawner.yaml from a local worktree.
- Use the returned URLs. For curl or Playwright, get the preview token header with
  \`spawner url <env> --with-token --json\`.
- Commands in ${database}: \`spawner exec <env> ${db === "none" ? "<service>" : "db"} -- <command>\` (\`-i\` sends stdin, such as a SQL file).
- Debugging: \`spawner logs <env> <service> --errors\`, and \`spawner status <env> --json\` for restarts and
  out-of-memory kills.
- If \`spawner up\` exits with code 4, read the log tail it printed, fix the cause, then retry. Code 7 means
  .spawner/ was refused: fix what it lists. Code 6 means your quota or the server's capacity is reached:
  \`spawner ls --all --mine --json\` lists your environments; delete those whose work is done, or ask a person.
- To show the result to someone without an account: \`spawner share <env>\`.
- When the task is done and validated, run \`spawner down <env>\`.
`;
}

/**
 * A project slug from a directory name: "My_App" gives "my-app".
 */
export function projectSlug(name: string): string | null {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, SLUG_MAX_LENGTH.project)
    .replace(/-+$/, "");
  return slug && !slugIssue("project", slug, "") ? slug : null;
}

/**
 * Guesses the database of a project from its dependencies.
 */
export function detectDatabase(dir: string): Database {
  const read = (file: string) => {
    try {
      return fs.readFileSync(path.join(dir, file), "utf8");
    } catch {
      return "";
    }
  };
  const node = read("package.json");
  if (node) {
    try {
      const pkg = JSON.parse(node) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      if (deps.some((dep) => ["pg", "postgres", "pg-promise"].includes(dep))) {
        return "postgres";
      }
      if (deps.some((dep) => ["mysql", "mysql2"].includes(dep))) {
        return "mysql";
      }
    } catch {
      return "none";
    }
  }
  const python = `${read("requirements.txt")}\n${read("pyproject.toml")}`.toLowerCase();
  if (/psycopg/.test(python)) {
    return "postgres";
  }
  if (/mysqlclient|pymysql|mysql-connector/.test(python)) {
    return "mysql";
  }
  return "none";
}

/**
 * The port the Dockerfile exposes, or 3000.
 */
export function detectPort(dockerfile: string | null): number {
  const match = dockerfile ? /^\s*EXPOSE\s+(\d+)/im.exec(dockerfile) : null;
  return match ? Number(match[1]) : 3000;
}

const DATABASE_SERVICES: Record<Exclude<Database, "none">, { service: string; url: string }> = {
  postgres: {
    url: "postgres://app:app@db:5432/app",
    service: `  db:
    image: postgres:18-alpine
    # Preview profile: small buffers, no waiting for the disk on commit.
    command: ["postgres", "-c", "shared_buffers=32MB", "-c", "max_wal_size=256MB", "-c", "synchronous_commit=off"]
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    volumes:
      - db-data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 2s
      retries: 30
`,
  },
  mysql: {
    url: "mysql://app:app@db:3306/app",
    service: `  db:
    image: mysql:8.4
    # Preview profile: no binary log, no performance schema, small buffers.
    command:
      - --skip-log-bin
      - --performance-schema=OFF
      - --innodb-buffer-pool-size=64M
      - --innodb-redo-log-capacity=16M
      - --innodb-flush-log-at-trx-commit=2
    environment:
      MYSQL_DATABASE: app
      MYSQL_USER: app
      MYSQL_PASSWORD: app
      MYSQL_ROOT_PASSWORD: root
    volumes:
      - db-data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-uroot", "-proot"]
      interval: 3s
      retries: 40
`,
  },
};

function manifestTemplate(project: string, port: number): string {
  return `# Spawner runs one preview environment of this project per branch.
# Reference: ${MANIFEST_DOCS}
version: 1
project: ${project}          # slug of the project on Spawner
compose: compose.yaml         # relative to .spawner/

exposures:                    # the first one is the entrypoint
  - name: web
    service: app
    port: ${port}

# seed:                       # run once, after the first start
#   - service: app
#     run: [npm, run, seed]

ttl: 72h
`;
}

function composeTemplate(db: Database, laravel: boolean): string {
  const database = db === "none" ? null : DATABASE_SERVICES[db];
  const environment = [
    "      PUBLIC_URL: ${SPAWNER_URL}",
    ...(database ? [`      DATABASE_URL: ${database.url}`] : []),
    ...(laravel ? ["      APP_URL: ${SPAWNER_URL}", "      LOG_CHANNEL: stderr      # errors in spawner logs"] : []),
  ];
  return `# Docker Compose file of the preview environments. Spawner refuses host
# mounts, published ports and privileged settings, and adds the URLs, limits
# and labels. Variables: \${SPAWNER_URL}, \${SPAWNER_URL_<EXPOSURE>},
# \${SPAWNER_HOST_<EXPOSURE>}, \${SPAWNER_SRC_<SOURCE>}, \${SPAWNER_ENV}.
services:
  app:
    build: ..                 # the Dockerfile at the root of the project
    environment:
${environment.join("\n")}
${
  database
    ? `    depends_on:
      db:
        condition: service_healthy

${database.service}
volumes:
  db-data:
`
    : ""
}`;
}

/**
 * Creates .spawner/spawner.yaml and .spawner/compose.yaml for the project
 * in dir, guessing the port and the database, and adds the instructions for
 * coding agents to agentsFile.
 */
export async function init(options: InitOptions): Promise<InitResult> {
  const dir = path.resolve(options.dir);
  const spawnerDir = path.join(dir, ".spawner");
  const manifestFile = path.join(spawnerDir, "spawner.yaml");
  const composeFile = path.join(spawnerDir, "compose.yaml");
  if (!options.force && (fs.existsSync(manifestFile) || fs.existsSync(composeFile))) {
    throw usageError(`${path.relative(process.cwd(), spawnerDir) || ".spawner"} already holds a project`, "--force replaces its files");
  }

  const fallback = path.basename((await gitTopLevel(dir)) ?? dir);
  const project = options.project ?? projectSlug(fallback);
  if (!project) {
    throw usageError(`cannot make a project name from "${fallback}"`, "give one: spawner init --project <slug>");
  }
  const issue = slugIssue("project", project, "project");
  if (issue) {
    throw usageError(issue.message, issue.hint);
  }

  const warnings: string[] = [];
  const dockerfilePath = path.join(dir, "Dockerfile");
  const dockerfile = fs.existsSync(dockerfilePath) ? fs.readFileSync(dockerfilePath, "utf8") : null;
  if (!dockerfile) {
    warnings.push("no Dockerfile at the root: write one (install the dependencies before copying the code, so that environments share those layers), or change build: in .spawner/compose.yaml");
  }
  const composer = fs.existsSync(path.join(dir, "composer.json")) ? fs.readFileSync(path.join(dir, "composer.json"), "utf8") : "";
  const laravel = composer.includes('"laravel/framework"');
  const db = options.db ?? detectDatabase(dir);
  const port = options.port ?? detectPort(dockerfile);

  const manifest = manifestTemplate(project, port);
  if (parseManifest(manifest).issues.length > 0) {
    throw new CliError("the generated spawner.yaml is invalid", { code: "internal" });
  }
  fs.mkdirSync(spawnerDir, { recursive: true });
  fs.writeFileSync(manifestFile, manifest);
  fs.writeFileSync(composeFile, composeTemplate(db, laravel));
  const files = [manifestFile, composeFile].map((file) => path.relative(dir, file));

  let agentsFile: string | null = null;
  if (options.agentsFile) {
    const target = path.resolve(dir, options.agentsFile);
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (current.includes(AGENTS_HEADING)) {
      warnings.push(`${path.relative(dir, target)} already has the Spawner instructions`);
    } else {
      const separator = current === "" ? "" : current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
      fs.writeFileSync(target, `${current}${separator}${agentInstructions(db)}`);
      agentsFile = path.relative(dir, target);
    }
  }
  return { project, files, agentsFile, warnings };
}

/**
 * The file that should get the agent instructions: CLAUDE.md or AGENTS.md
 * when the project has one, else AGENTS.md.
 */
export function defaultAgentsFile(dir: string): { file: string; exists: boolean } {
  for (const file of ["CLAUDE.md", "AGENTS.md"]) {
    if (fs.existsSync(path.join(dir, file))) {
      return { file, exists: true };
    }
  }
  return { file: "AGENTS.md", exists: false };
}
