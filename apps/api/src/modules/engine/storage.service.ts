import { Injectable, OnModuleInit } from "@nestjs/common";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { SpawnerConfig } from "./spawner.config";

/**
 * Layout of the data directory:
 *
 *   mirrors/<hash>.git          bare, partial git mirrors
 *   envs/<env-id>/src/<source>  code of each source (worktree or upload)
 *   envs/<env-id>/compose.rendered.yaml
 *   traefik/<env-id>.yaml       routing read by Traefik's file provider
 *   jobs/<job-id>.log           job logs
 *   uploads/                    archives being received
 *   home/                       HOME of the git and docker commands
 */
@Injectable()
export class StorageService implements OnModuleInit {
  constructor(private readonly config: SpawnerConfig) {}

  onModuleInit() {
    for (const dir of [this.mirrorsDir, this.envsDir, this.traefikDir, this.jobsDir, this.uploadsDir, this.homeDir, this.config.keysDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  get mirrorsDir() {
    return path.join(this.config.dataDir, "mirrors");
  }

  get envsDir() {
    return path.join(this.config.dataDir, "envs");
  }

  get traefikDir() {
    return path.join(this.config.dataDir, "traefik");
  }

  get jobsDir() {
    return path.join(this.config.dataDir, "jobs");
  }

  get uploadsDir() {
    return path.join(this.config.dataDir, "uploads");
  }

  get homeDir() {
    return path.join(this.config.dataDir, "home");
  }

  mirrorDir(repoUrl: string): string {
    const hash = createHash("sha256").update(repoUrl).digest("hex").slice(0, 16);
    return path.join(this.mirrorsDir, `${hash}.git`);
  }

  envDir(environmentId: string): string {
    return path.join(this.envsDir, environmentId);
  }

  sourcesDir(environmentId: string): string {
    return path.join(this.envDir(environmentId), "src");
  }

  sourceDir(environmentId: string, source: string): string {
    return path.join(this.sourcesDir(environmentId), source);
  }

  renderedComposePath(environmentId: string): string {
    return path.join(this.envDir(environmentId), "compose.rendered.yaml");
  }

  traefikFile(environmentId: string): string {
    return path.join(this.traefikDir, `${environmentId}.yaml`);
  }

  jobLogPath(jobId: string): string {
    return path.join(this.jobsDir, `${jobId}.log`);
  }

  /**
   * Writes a file through a temporary file and a rename, so readers such as
   * Traefik never see a half-written file.
   */
  writeAtomic(target: string, content: string): void {
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, content, { mode: 0o640 });
    fs.renameSync(temporary, target);
  }
}
