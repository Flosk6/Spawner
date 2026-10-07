import type { Environment, EnvironmentSource, ServiceState, ServiceUsage } from "@spawner/types";
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
  if (status === "stopped" || status === "deleted") {
    return style.dim(status);
  }
  return style.yellow(status);
}

/** "Florian via claude-laptop (cli)". */
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
 * A detailed view of an environment and its services, for spawner status.
 */
export function renderStatus(environment: Environment, services: ServiceState[], style: Styles): string {
  const lines: string[] = [`${style.bold(environment.slug)} ${style.dim(`(${environment.project})`)}  ${statusLabel(environment.status, style)}`];
  if (environment.status === "failed" && environment.error) {
    lines.push(style.red(`Failed${environment.phase ? ` during ${environment.phase}` : ""}: ${environment.error.split("\n")[0]}`));
  }
  const rows: [string, string[]][] = [
    ["Owner", [ownerLabel(environment)]],
    ["URLs", environment.exposures.length ? urlLines(environment, style) : [style.dim("none yet")]],
    ["Sources", environment.sources.map((source) => `${source.name}  ${sourceLabel(source)}`)],
    ["Expires", [environment.expiresAt ? `${relativeTime(environment.expiresAt)} (${new Date(environment.expiresAt).toLocaleString()})` : "-"]],
    ["Last job", [environment.lastJob ? `${environment.lastJob.type} ${environment.lastJob.status} ${relativeTime(environment.lastJob.finishedAt ?? environment.lastJob.createdAt)}` : "-"]],
  ];
  for (const [label, values] of rows) {
    values.forEach((value, index) => lines.push(`${index === 0 ? label.padEnd(9) : " ".repeat(9)} ${value}`));
  }
  if (services.length > 0) {
    lines.push("", renderServices(services, style));
  }
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
