import { Injectable } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { sanitizeGitBranch, sanitizeGitRepo } from "@spawner/utils";
import { GitKeysService } from "./git-keys.service";
import { KeyedMutex } from "./keyed-mutex";
import { baseEnv, run } from "./process";
import { SpawnerConfig } from "./spawner.config";
import { StorageService } from "./storage.service";

const NETWORK_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Git access for the engine. Each repository has one bare, partial mirror
 * (file contents are only downloaded when checked out) holding branches and
 * tags; each environment gets its own detached worktree of it. A lock per
 * mirror serializes fetches and worktree changes, so two environments never
 * step on each other, unlike the former shared clone.
 */
@Injectable()
export class GitMirrorService {
  private readonly locks = new KeyedMutex();

  constructor(
    private readonly config: SpawnerConfig,
    private readonly storage: StorageService,
    private readonly keys: GitKeysService,
  ) {}

  /**
   * Validates a repository URL: SSH or HTTPS only (file:// in tests).
   *
   * @throws Error when the URL is not accepted
   */
  validateRepoUrl(repoUrl: string): string {
    if (this.config.allowLocalRepos && /^file:\/\/\//.test(repoUrl)) {
      return repoUrl;
    }
    return sanitizeGitRepo(repoUrl);
  }

  /**
   * Checks out a branch, tag or commit of a repository into target, replacing
   * what was there.
   *
   * @param repoUrl - Repository URL
   * @param ref - Branch, tag or commit to check out
   * @param target - Directory of the worktree
   * @param onLine - Receives git output lines
   * @returns The commit checked out
   */
  async checkout(repoUrl: string, ref: string, target: string, onLine: (line: string) => void): Promise<{ commit: string }> {
    this.validateRepoUrl(repoUrl);
    sanitizeGitBranch(ref);
    const mirror = this.storage.mirrorDir(repoUrl);

    return this.locks.run(mirror, async () => {
      const env = this.env(repoUrl);

      if (!fs.existsSync(path.join(mirror, "HEAD"))) {
        fs.rmSync(mirror, { recursive: true, force: true });
        onLine(`Cloning ${repoUrl}`);
        await run("git", ["clone", "--bare", "--filter=blob:none", "--no-tags", "--", repoUrl, mirror], {
          env,
          timeoutMs: NETWORK_TIMEOUT_MS,
          onLine,
        });
      }

      onLine(`Fetching ${repoUrl}`);
      await run(
        "git",
        ["-C", mirror, "fetch", "--prune", "--filter=blob:none", "origin", "+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*"],
        { env, timeoutMs: NETWORK_TIMEOUT_MS, onLine },
      );

      let commit: string;
      try {
        commit = (await run("git", ["-C", mirror, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { env })).stdout.trim();
      } catch {
        throw new Error(`"${ref}" is not a branch, tag or commit of ${repoUrl}`);
      }

      await this.removeWorktreeLocked(mirror, target, env);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await run("git", ["-C", mirror, "worktree", "add", "--detach", "--force", target, commit], {
        env,
        timeoutMs: NETWORK_TIMEOUT_MS,
        onLine,
      });
      onLine(`Checked out ${ref} at ${commit.slice(0, 12)}`);
      return { commit };
    });
  }

  /**
   * Removes the worktree of an environment.
   */
  async removeWorktree(repoUrl: string, target: string): Promise<void> {
    const mirror = this.storage.mirrorDir(repoUrl);
    if (!fs.existsSync(mirror)) {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    }
    await this.locks.run(mirror, () => this.removeWorktreeLocked(mirror, target, this.env(repoUrl)));
  }

  /**
   * Lists the branches of a repository without cloning it.
   */
  async listBranches(repoUrl: string): Promise<string[]> {
    this.validateRepoUrl(repoUrl);
    const { stdout } = await run("git", ["ls-remote", "--heads", "--", repoUrl], { env: this.env(repoUrl), timeoutMs: 30_000 });
    return stdout
      .split("\n")
      .map((line) => /\trefs\/heads\/(.+)$/.exec(line)?.[1])
      .filter((branch): branch is string => Boolean(branch))
      .sort();
  }

  /**
   * Checks that Spawner can read a repository with its keys.
   */
  async testAccess(repoUrl: string): Promise<{ ok: boolean; message: string }> {
    try {
      this.validateRepoUrl(repoUrl);
      await run("git", ["ls-remote", "--", repoUrl, "HEAD"], { env: this.env(repoUrl), timeoutMs: 15_000 });
      return { ok: true, message: "Connection successful" };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  }

  private async removeWorktreeLocked(mirror: string, target: string, env: Record<string, string>): Promise<void> {
    if (fs.existsSync(target)) {
      await run("git", ["-C", mirror, "worktree", "remove", "--force", target], { env }).catch(() => undefined);
      fs.rmSync(target, { recursive: true, force: true });
    }
    await run("git", ["-C", mirror, "worktree", "prune"], { env }).catch(() => undefined);
  }

  /**
   * Environment of git commands: no prompt, no system config, SSH and HTTPS
   * transports only, and the repository's deploy key. Hosts are trusted on
   * first use and pinned in known_hosts afterwards.
   */
  private env(repoUrl: string): Record<string, string> {
    const ssh = [
      "ssh",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      `UserKnownHostsFile=${this.keys.knownHostsPath}`,
    ];
    const key = this.keys.keyPathFor(repoUrl);
    if (key) {
      ssh.push("-o", "IdentitiesOnly=yes", "-i", key);
    }
    return {
      ...baseEnv(this.storage.homeDir),
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_ALLOW_PROTOCOL: this.config.allowLocalRepos ? "ssh:https:file" : "ssh:https",
      GIT_SSH_COMMAND: ssh.map(shellQuote).join(" "),
    };
  }
}

/**
 * git runs GIT_SSH_COMMAND through a shell, so every word is single-quoted.
 */
function shellQuote(word: string): string {
  return `'${word.replace(/'/g, `'\\''`)}'`;
}
