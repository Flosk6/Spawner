import { Injectable } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { PrismaService } from "../../common/prisma.service";
import { baseEnv, run } from "./process";
import { SpawnerConfig } from "./spawner.config";

export interface RepoKeyInfo {
  gitRepo: string;
  keyExists: boolean;
  publicKey?: string;
  usedBy: string[];
}

const GLOBAL_KEY = "id_spawner";

/**
 * SSH deploy keys. Each repository can have its own read-only key
 * (id_<host>_<owner>_<repo>); a global key (id_spawner) is used for the
 * others. HTTPS repositories need no key.
 */
@Injectable()
export class GitKeysService {
  constructor(
    private readonly config: SpawnerConfig,
    private readonly prisma: PrismaService,
  ) {}

  get knownHostsPath(): string {
    return path.join(this.config.keysDir, "known_hosts");
  }

  /**
   * The private key to use for a repository: its own key if it has one,
   * else the global key, else none.
   */
  keyPathFor(repoUrl: string): string | null {
    const own = path.join(this.config.keysDir, this.keyNameFor(repoUrl));
    if (fs.existsSync(own)) {
      return own;
    }
    const global = path.join(this.config.keysDir, GLOBAL_KEY);
    return fs.existsSync(global) ? global : null;
  }

  globalKeyInfo(): { exists: boolean; publicKey: string | null } {
    const publicKey = this.readPublicKey(path.join(this.config.keysDir, GLOBAL_KEY));
    return { exists: publicKey !== null, publicKey };
  }

  async generateGlobalKey(): Promise<{ exists: boolean; publicKey: string }> {
    const keyPath = path.join(this.config.keysDir, GLOBAL_KEY);
    if (fs.existsSync(keyPath)) {
      throw new Error("The global deploy key already exists");
    }
    return { exists: true, publicKey: await this.generate(keyPath, "spawner-deploy-key") };
  }

  /**
   * Generates (or regenerates) the deploy key of one repository.
   */
  async generateKeyForRepo(gitRepo: string): Promise<{ publicKey: string; privateKeyPath: string }> {
    const keyName = this.keyNameFor(gitRepo);
    const keyPath = path.join(this.config.keysDir, keyName);
    fs.rmSync(keyPath, { force: true });
    fs.rmSync(`${keyPath}.pub`, { force: true });
    return { publicKey: await this.generate(keyPath, `spawner-${keyName}`), privateKeyPath: keyPath };
  }

  /**
   * Lists the repositories Spawner clones (project repositories and the
   * extra sources of their manifests) with the state of their key.
   */
  async listRepos(): Promise<RepoKeyInfo[]> {
    const projects = await this.prisma.project.findMany({
      include: { environments: { where: { deletedAt: null }, select: { manifest: true } } },
    });

    const repos = new Map<string, Set<string>>();
    const use = (repo: string, by: string) => {
      if (!repos.has(repo)) {
        repos.set(repo, new Set());
      }
      repos.get(repo)!.add(by);
    };

    for (const project of projects) {
      use(project.repoUrl, project.slug);
      for (const environment of project.environments) {
        const sources = (environment.manifest as { sources?: Record<string, { repo: string }> } | null)?.sources ?? {};
        Object.entries(sources).forEach(([name, source]) => use(source.repo, `${project.slug}/${name}`));
      }
    }

    return [...repos.entries()]
      .map(([gitRepo, usedBy]) => {
        const publicKey = this.readPublicKey(path.join(this.config.keysDir, this.keyNameFor(gitRepo)));
        return { gitRepo, keyExists: publicKey !== null, publicKey: publicKey ?? undefined, usedBy: [...usedBy].sort() };
      })
      .sort((a, b) => a.gitRepo.localeCompare(b.gitRepo));
  }

  /**
   * Key file name of a repository: git@github.com:org/repo.git and
   * https://github.com/org/repo.git both give id_github_com_org_repo.
   */
  keyNameFor(gitRepo: string): string {
    const identifier = gitRepo
      .replace(/^git@/, "")
      .replace(/^https?:\/\//, "")
      .replace(/\.git$/, "")
      .replace(/[^a-zA-Z0-9]/g, "_")
      .toLowerCase();
    return `id_${identifier}`;
  }

  private async generate(keyPath: string, comment: string): Promise<string> {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    await run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", comment, "-f", keyPath], {
      env: baseEnv(this.config.dataDir),
      timeoutMs: 30_000,
    });
    return fs.readFileSync(`${keyPath}.pub`, "utf8").trim();
  }

  private readPublicKey(keyPath: string): string | null {
    try {
      return fs.readFileSync(`${keyPath}.pub`, "utf8").trim();
    } catch {
      return null;
    }
  }
}
