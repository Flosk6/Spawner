import type { Capacity, CrashLoop, Environment, EnvironmentSource, ServiceState, ServiceUsage, TimelineEvent } from "@spawner/types";
import { formatBytes, relativeTime, table } from "./format";
import type { Styles } from "./output";

/**
 * The status of an environment, colored: green when ready, red when failed,
 * yellow while a job runs.
 */
export function statusLabel(status: string, style: Styles): string {
  if (status === "ready") {
    return style.green(status);
  }
  if (status === "failed") {
    return style.red(status);
  }
  if (status === "stopped" || status === "deleted" || status === "sleeping") {
    return style.dim(status);
  }
  return style.yellow(status);
}

/** "Ada via claude-laptop (cli)". */
export function ownerLabel(environment: Environment): string {
  const owner = environment.owner?.name ?? (environment.tokenName ? "" : "installation");
  const via = environment.tokenName ? `${owner ? `${owner} via ` : ""}${environment.tokenName}` : owner;
  return `${via} (${environment.createdVia})`;
}

/** "upload, 2.3 MiB" or "git develop @ 3f2a1c4". */
export function sourceLabel(source: EnvironmentSource): string {
  if (source.origin === "upload") {
    return `upload${source.sizeBytes !== null ? `, ${formatBytes(source.sizeBytes)}` : ""}${source.digest ? ` (sha256 ${source.digest.slice(0, 8)})` : ""}`;
  }
  return `git ${source.ref ?? "?"}${source.commit ? ` @ ${source.commit.slice(0, 7)}` : ""}`;
}

/** URLs, one per line, the entrypoint first. */
export function urlLines(environment: Environment, style: Styles): string[] {
  const exposures = [...environment.exposures].sort((a, b) => Number(b.entrypoint) - Number(a.entrypoint));
  const width = Math.max(0, ...exposures.map((exposure) => exposure.name.length));
  return exposures.map((exposure) => `${exposure.name.padEnd(width)}  ${style.cyan(environment.urls[exposure.name] ?? exposure.host)}`);
}

/**
 * A detailed view of an environment, its services and its last events, for
 * spawner status.
 */
export function renderStatus(
  environment: Environment,
  services: ServiceState[],
  style: Styles,
  timeline: { events: TimelineEvent[]; crashLoops: CrashLoop[] } = { events: [], crashLoops: [] },
): string {
  const lines: string[] = [`${style.bold(environment.slug)} ${style.dim(`(${environment.project})`)}  ${statusLabel(environment.status, style)}`];
  if (environment.status === "failed" && environment.error) {
    lines.push(style.red(`Failed${environment.phase ? ` during ${environment.phase}` : ""}: ${environment.error.split("\n")[0]}`));
  }
  if (environment.status === "degraded" && environment.error) {
    lines.push(style.yellow(`Degraded: ${environment.error}`));
  }
  if (environment.status === "sleeping") {
    lines.push(style.dim("Asleep: its data stays, and the next visit to one of its URLs (or spawner wake) wakes it up."));
  }
  const rows: [string, string[]][] = [
    ["Owner", [ownerLabel(environment)]],
    ["URLs", environment.exposures.length ? urlLines(environment, style) : [style.dim("none yet")]],
    ["Sources", environment.sources.map((source) => `${source.name}  ${sourceLabel(source)}`)],
    ["Expires", [environment.expiresAt ? `${relativeTime(environment.expiresAt)} (${new Date(environment.expiresAt).toLocaleString()})` : "-"]],
    ["Sleeps", [sleepLabel(environment)]],
    ["Last job", [environment.lastJob ? `${environment.lastJob.type} ${environment.lastJob.status} ${relativeTime(environment.lastJob.finishedAt ?? environment.lastJob.createdAt)}` : "-"]],
  ];
  for (const [label, values] of rows) {
    values.forEach((value, index) => lines.push(`${index === 0 ? label.padEnd(9) : " ".repeat(9)} ${value}`));
  }
  if (services.length > 0) {
    lines.push("", renderServices(services, style));
  }
  for (const loop of timeline.crashLoops) {
    lines.push(style.red(`${loop.service} failed ${loop.count} times in ${loop.windowMinutes} minutes, last cause: ${loop.lastCause}`));
  }
  if (timeline.events.length > 0) {
    lines.push("", style.dim("Recent events"));
    for (const event of timeline.events.slice(0, 10)) {
      const color = event.type === "crash" || event.type === "oom" || event.type === "job_failed" || event.type === "unhealthy" ? style.red : style.dim;
      lines.push(`  ${style.dim(new Date(event.time).toLocaleTimeString())}  ${color(event.message)}`);
    }
  }
  return lines.join("\n");
}

/**
 * Room for more environments of each project, for spawner capacity.
 */
/** "in 1h 40m without activity", "never", "asleep". */
function sleepLabel(environment: Environment): string {
  if (environment.status === "sleeping") {
    return "asleep";
  }
  if (environment.idleSeconds === 0) {
    return "never";
  }
  if (!environment.sleepsAt) {
    return `after ${Math.round(environment.idleSeconds / 60)} minutes without activity`;
  }
  return new Date(environment.sleepsAt).getTime() > Date.now() ? `${relativeTime(environment.sleepsAt)} without activity` : "within a minute, without activity";
}

export function renderCapacity(result: Capacity, style: Styles, formatBytes: (bytes: number) => string): string {
  const lines: string[] = [];
  if (result.quota) {
    const text = `Your environments: ${result.quota.used} of ${result.quota.limit} (sleeping ones included)`;
    lines.push(result.quota.remaining === 0 ? style.red(text) : text, "");
  }
  if (result.host) {
    const guard = result.host.buildGuards?.memoryBytes;
    lines.push(
      `Available: ${formatBytes(result.host.availableMemoryBytes)} of memory, ${formatBytes(result.host.freeDiskBytes)} of disk ` +
        style.dim(
          `(${formatBytes(result.host.reserves.memoryBytes)} and ${formatBytes(result.host.reserves.diskBytes)} kept free` +
            (guard ? `, ${formatBytes(guard)} of memory free before each build)` : ")"),
        ),
      "",
    );
  }
  lines.push(
    table(
      result.projects.map((project) => [
        style.bold(project.project),
        project.places === null ? "-" : project.places === 0 ? style.red("0") : String(project.places),
        project.limitedBy ?? "-",
        `${formatBytes(project.memoryBytes)} ${style.dim(project.basedOn.memory === "usage" ? "(measured)" : "(limits)")}`,
        `${formatBytes(project.diskBytes)} ${style.dim(project.basedOn.disk === "usage" ? "(measured)" : "(estimate)")}`,
      ]),
      ["PROJECT", "PLACES", "LIMITED BY", "MEMORY EACH", "DISK EACH"].map((title) => style.dim(title)),
    ),
  );
  return lines.join("\n");
}

function health(service: ServiceState, style: Styles): string {
  if (!service.health) {
    return style.dim("-");
  }
  return service.health === "healthy" ? style.green(service.health) : service.health === "unhealthy" ? style.red(service.health) : style.yellow(service.health);
}

function state(service: ServiceState, style: Styles): string {
  const text = service.exitCode !== null && service.state !== "running" ? `${service.state} (${service.exitCode})` : service.state;
  return service.state === "running" ? text : style.red(text);
}

/**
 * The services of an environment: state, health, restarts and kills for
 * lack of memory.
 */
export function renderServices(services: ServiceState[], style: Styles): string {
  return table(
    services.map((service) => [
      service.name,
      state(service, style),
      health(service, style),
      service.restartCount > 0 ? style.yellow(String(service.restartCount)) : "0",
      service.oomKilled ? style.red("yes") : "-",
    ]),
    ["SERVICE", "STATE", "HEALTH", "RESTARTS", "OOM"].map((title) => style.dim(title)),
  );
}

/**
 * Usage of the services right now, for spawner stats.
 */
export function renderUsage(services: ServiceUsage[], style: Styles): string {
  return table(
    services.map((service) => [
      service.name,
      state(service, style),
      health(service, style),
      service.cpuPercent === null ? "-" : `${service.cpuPercent.toFixed(1)}%`,
      service.memoryBytes === null ? "-" : `${formatBytes(service.memoryBytes)}${service.memoryLimitBytes ? ` / ${formatBytes(service.memoryLimitBytes)}` : ""}`,
      service.diskBytes === null ? "-" : formatBytes(service.diskBytes),
      service.restartCount > 0 ? style.yellow(String(service.restartCount)) : "0",
      service.oomKilled ? style.red("yes") : "-",
    ]),
    ["SERVICE", "STATE", "HEALTH", "CPU", "MEMORY", "DISK", "RESTARTS", "OOM"].map((title) => style.dim(title)),
  );
}

/**
 * Environments in a table, for spawner ls.
 */
export function renderList(environments: Environment[], style: Styles): string {
  const projects = new Set(environments.map((environment) => environment.project));
  const withProject = projects.size > 1;
  return table(
    environments.map((environment) => [
      ...(withProject ? [environment.project] : []),
      style.bold(environment.slug),
      statusLabel(environment.status, style),
      ownerLabel(environment),
      environment.url ? style.cyan(environment.url) : style.dim("-"),
      relativeTime(environment.expiresAt),
    ]),
    [...(withProject ? ["PROJECT"] : []), "ENV", "STATUS", "OWNER", "URL", "EXPIRES"].map((title) => style.dim(title)),
  );
}
