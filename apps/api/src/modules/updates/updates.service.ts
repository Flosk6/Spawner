import { BadRequestException, ConflictException, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import * as fs from "fs";
import { describeActor, type Actor } from "../../common/actor";
import { DockerService } from "../../common/docker.service";
import { PrismaService } from "../../common/prisma.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { SPAWNER_VERSION } from "../../common/version";
import { AuditService } from "../audit/audit.service";
import { newestUpdate, splitImage, upgradeHelper, UPGRADE_CONTAINER, type GithubRelease, type Release, type UpdateRun } from "./releases";

const RUN_KEY = "update.run";
const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 6 * 3600_000;
const SETTLE_EVERY_MS = 30_000;
const LOG_LINES = 40;
/** When this process started: a download older than this was cut short by a restart. */
const STARTED_AT = new Date();

type Installation =
  | { kind: "managed"; repository: string; installDir: string; socket: string }
  | { kind: "unmanaged"; reason: string };

/**
 * Updates of Spawner from the dashboard. Spawner reads the list of releases
 * every few hours. When an admin asks, it downloads the image of the newest
 * version and starts a short-lived container of it that runs that version's
 * installer with --upgrade: it backs the database up, writes the files of
 * the installation, and restarts the stack. The container outlives the
 * Spawner it replaces, and puts the previous version back when the new one
 * does not start. The run is recorded in the settings table, so that the
 * Spawner that comes up (new or previous) says how it went.
 */
@Injectable()
export class UpdatesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(UpdatesService.name);
  private checked: { at: string; error: string | null; latest: Release | null } | null = null;
  private settling: Promise<UpdateRun | null> | null = null;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly docker: DockerService,
    private readonly config: SpawnerConfig,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === "test") {
      return;
    }
    const first = setTimeout(() => void this.settle().then(() => (this.config.updateCheck ? this.check() : undefined)), FIRST_CHECK_MS);
    first.unref();
    this.timers.push(first, setInterval(() => void this.settle(), SETTLE_EVERY_MS));
    if (this.config.updateCheck) {
      this.timers.push(setInterval(() => void this.check(), CHECK_EVERY_MS));
    }
  }

  onModuleDestroy(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
  }

  /**
   * The version running, the newest one this server may move to, whether it
   * can update itself, and the last update started from the dashboard.
   */
  async status() {
    const run = await this.settle();
    const installation = await this.installation();
    return {
      current: SPAWNER_VERSION,
      managed: installation.kind === "managed",
      reason: installation.kind === "unmanaged" ? installation.reason : null,
      automaticChecks: this.config.updateCheck,
      checkedAt: this.checked?.at ?? null,
      checkError: this.checked?.error ?? null,
      latest: this.checked?.latest ?? null,
      run,
    };
  }

  /**
   * Reads the list of releases now. A failure keeps the last answer and is
   * shown with it.
   */
  async check(): Promise<void> {
    try {
      const releases = await this.releases();
      this.checked = { at: new Date().toISOString(), error: null, latest: newestUpdate(SPAWNER_VERSION, releases) };
    } catch (error) {
      this.logger.warn(`Could not read the releases: ${(error as Error).message}`);
      this.checked = { at: new Date().toISOString(), error: (error as Error).message, latest: this.checked?.latest ?? null };
    }
  }

  /**
   * Starts the update to the newest version: refused while another runs,
   * while jobs run (Spawner restarts), or when this server was not installed
   * by install.sh from a release image.
   *
   * @throws BadRequestException when there is nothing to update to, or no way to
   * @throws ConflictException when an update or jobs are running
   */
  async start(actor: Actor): Promise<UpdateRun> {
    const installation = await this.installation();
    if (installation.kind === "unmanaged") {
      throw new BadRequestException(installation.reason);
    }
    const previous = await this.settle();
    if (previous?.state === "running") {
      throw new ConflictException(`Spawner is already updating to ${previous.to}`);
    }
    const jobs = await this.prisma.job.count({ where: { status: "running" } });
    if (jobs > 0) {
      throw new ConflictException(`${jobs} job${jobs === 1 ? " is" : "s are"} running and would be interrupted: update once ${jobs === 1 ? "it ends" : "they end"}`);
    }
    await this.check();
    const latest = this.checked?.latest;
    if (!latest) {
      throw new BadRequestException(this.checked?.error ? `The list of releases could not be read: ${this.checked.error}` : "Spawner is up to date");
    }
    const run: UpdateRun = {
      from: SPAWNER_VERSION,
      to: latest.version,
      by: describeActor(actor),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      state: "running",
      phase: "downloading",
      error: null,
      log: [],
    };
    await this.save(run);
    await this.audit.record(actor, "system.update", { target: run.to, details: { from: run.from, to: run.to } });
    void this.install(installation, run);
    return run;
  }

  /**
   * Downloads the new image, then starts the container that installs it.
   */
  private async install(installation: Extract<Installation, { kind: "managed" }>, run: UpdateRun): Promise<void> {
    const image = `${installation.repository}:${run.to}`;
    try {
      await this.docker.pullImage(image);
      await this.docker.removeContainer(UPGRADE_CONTAINER);
      const helper = await this.docker.client.createContainer(
        upgradeHelper({ image, version: run.to, installDir: installation.installDir, dataDir: this.config.dataDir, socket: installation.socket }),
      );
      await this.save({ ...run, phase: "installing" });
      await helper.start();
    } catch (error) {
      await this.finish(run, "failed", `The update could not start: ${(error as Error).message}`, []);
    }
  }

  /**
   * The last run, brought up to date with what happened to its installer:
   * done when this Spawner runs the new version and the installer ended
   * well, failed when the installer ended otherwise (it put the previous
   * version back) or when a restart cut the download short. Calls at the same
   * time share one pass, so that a run ends once.
   */
  private settle(): Promise<UpdateRun | null> {
    this.settling ??= this.settleOnce().finally(() => (this.settling = null));
    return this.settling;
  }

  private async settleOnce(): Promise<UpdateRun | null> {
    const run = await this.load();
    if (!run || run.state !== "running") {
      return run;
    }
    if (run.phase === "downloading") {
      return new Date(run.startedAt) < STARTED_AT ? this.finish(run, "failed", "Spawner restarted while it downloaded the new version", []) : run;
    }
    const helper = await this.docker.client
      .getContainer(UPGRADE_CONTAINER)
      .inspect()
      .catch(() => null);
    if (helper?.State.Running) {
      return run;
    }
    const log = helper ? await this.docker.tail(UPGRADE_CONTAINER, LOG_LINES).catch(() => []) : [];
    await this.docker.removeContainer(UPGRADE_CONTAINER).catch(() => undefined);
    if (SPAWNER_VERSION === run.to && helper?.State.ExitCode === 0) {
      return this.finish(run, "succeeded", null, log);
    }
    if (SPAWNER_VERSION === run.from) {
      const why = helper ? "the new version did not start, and Spawner went back to the previous one" : "the installer stopped before the end";
      return this.finish(run, "failed", `The update to ${run.to} failed: ${why}`, log);
    }
    return this.finish(run, "failed", `The installer of ${run.to} ended with an error: read its output`, log);
  }

  private async finish(run: UpdateRun, state: "succeeded" | "failed", error: string | null, log: string[]): Promise<UpdateRun> {
    const done: UpdateRun = { ...run, state, phase: null, error, log, finishedAt: new Date().toISOString() };
    await this.save(done);
    await this.audit.record(null, `system.update.${state}`, { actorName: "Spawner (update)", target: run.to, details: { from: run.from, to: run.to, error } });
    return done;
  }

  /**
   * Whether this server can update itself, from the container Spawner runs
   * in: a container of the compose project "spawner" that install.sh wrote,
   * running a release image tagged with this version.
   */
  private async installation(): Promise<Installation> {
    const self = await this.docker.self();
    if (!self) {
      return { kind: "unmanaged", reason: "Spawner does not run in a container here: update it the way you started it" };
    }
    const labels = self.Config.Labels ?? {};
    const installDir = labels["com.docker.compose.project.working_dir"];
    const image = splitImage(self.Config.Image);
    if (labels["com.docker.compose.project"] !== "spawner" || !installDir || !image || image.tag !== SPAWNER_VERSION) {
      return { kind: "unmanaged", reason: "Spawner was not installed by install.sh from a release image: update it the way it was installed" };
    }
    const socket = self.Mounts?.find((mount) => mount.Destination === "/var/run/docker.sock")?.Source ?? "/var/run/docker.sock";
    return { kind: "managed", repository: image.repository, installDir, socket };
  }

  private async releases(): Promise<GithubRelease[]> {
    const url = this.config.releasesUrl;
    const body: unknown = url.startsWith("file://")
      ? JSON.parse(fs.readFileSync(new URL(url), "utf8"))
      : await fetch(url, {
          headers: { Accept: "application/vnd.github+json", "User-Agent": `spawner/${SPAWNER_VERSION}` },
          signal: AbortSignal.timeout(15_000),
        }).then((response) => {
          if (!response.ok) {
            throw new Error(`${new URL(url).host} answered ${response.status}`);
          }
          return response.json();
        });
    if (!Array.isArray(body)) {
      throw new Error("the answer is not a list of releases");
    }
    return body as GithubRelease[];
  }

  private async load(): Promise<UpdateRun | null> {
    const row = await this.prisma.setting.findUnique({ where: { key: RUN_KEY } });
    return row ? (JSON.parse(row.value) as UpdateRun) : null;
  }

  private async save(run: UpdateRun): Promise<void> {
    const value = JSON.stringify(run);
    await this.prisma.setting.upsert({ where: { key: RUN_KEY }, create: { key: RUN_KEY, value }, update: { value } });
  }
}
