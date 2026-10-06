import { Injectable, OnModuleInit } from "@nestjs/common";
import Docker from "dockerode";
import * as os from "os";
import * as path from "path";
import * as stream from "stream";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}

const LABEL_ENV = "dev.spawner.env";
const LABEL_COMPOSE_SERVICE = "com.docker.compose.service";

/**
 * Thin wrapper around the Docker API (dockerode). Environments are found by
 * the dev.spawner.* labels Spawner puts on every container, volume and
 * network it creates; no command ever goes through a shell.
 */
@Injectable()
export class DockerService implements OnModuleInit {
  private docker: Docker;

  onModuleInit() {
    const socketPath = process.env.DOCKER_SOCKET || "/var/run/docker.sock";
    this.docker = new Docker({ socketPath });
  }

  get client(): Docker {
    return this.docker;
  }

  /**
   * Removes a directory as root, from a short-lived container of Spawner's
   * own image with the directory's parent mounted. The data directory has
   * the same path on the host and in Spawner's container, so the daemon
   * mounts the right directory.
   *
   * @param dir - Absolute path of the directory to remove
   * @throws When Spawner does not run in a container (development)
   */
  async removeAsRoot(dir: string): Promise<void> {
    const self = await this.docker
      .getContainer(os.hostname())
      .inspect()
      .catch(() => null);
    if (!self) {
      throw new Error(`${dir} holds files Spawner cannot delete, and Spawner does not run in a container to delete them as root`);
    }
    const container = await this.docker.createContainer({
      Image: self.Image,
      User: "0",
      Entrypoint: ["rm", "-rf", "--", `/parent/${path.basename(dir)}`],
      Cmd: [],
      HostConfig: { Binds: [`${path.dirname(dir)}:/parent`], NetworkMode: "none" },
    });
    try {
      await container.start();
      const { StatusCode } = await container.wait();
      if (StatusCode !== 0) {
        throw new Error(`removing ${dir} as root failed (exit code ${StatusCode})`);
      }
    } finally {
      await container.remove({ force: true }).catch(() => undefined);
    }
  }

  /**
   * Lists the containers of an environment, running or not.
   */
  async listEnvironmentContainers(environmentId: string): Promise<Docker.ContainerInfo[]> {
    return this.docker.listContainers({
      all: true,
      filters: { label: [`${LABEL_ENV}=${environmentId}`] },
    });
  }

  /**
   * Finds the container of a compose service in an environment.
   */
  async findServiceContainer(environmentId: string, service: string): Promise<Docker.ContainerInfo | null> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: [`${LABEL_ENV}=${environmentId}`, `${LABEL_COMPOSE_SERVICE}=${service}`] },
    });
    return containers[0] ?? null;
  }

  /**
   * Runs a command in a container with an argument array (no shell) and
   * returns its exit code and separate outputs, each capped.
   *
   * @param containerId - Target container
   * @param argv - Command and arguments
   * @param options - Timeout and output cap
   */
  async exec(
    containerId: string,
    argv: string[],
    options: { timeoutMs: number; maxOutputBytes: number }
  ): Promise<ExecResult> {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({ Cmd: argv, AttachStdout: true, AttachStderr: true });
    const execStream = await exec.start({ hijack: true, stdin: false });

    const stdout = new CappedBuffer(options.maxOutputBytes);
    const stderr = new CappedBuffer(options.maxOutputBytes);
    this.docker.modem.demuxStream(execStream, stdout.writable(), stderr.writable());

    const timedOut = await new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        execStream.destroy();
        resolve(true);
      }, options.timeoutMs);
      execStream.on("end", () => {
        clearTimeout(timer);
        resolve(false);
      });
      execStream.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    const inspect = timedOut ? null : await exec.inspect();
    return {
      exitCode: inspect?.ExitCode ?? -1,
      stdout: stdout.text(),
      stderr: stderr.text(),
      truncated: stdout.truncated || stderr.truncated,
      timedOut,
    };
  }

  /**
   * Opens an interactive TTY session in a running container through the
   * Docker exec API. The returned stream is raw (not multiplexed): writes go
   * to the process stdin, data events carry its terminal output.
   *
   * @param containerNameOrId - Target container
   * @param options - Shell command, user and working directory for the session
   * @returns The bidirectional stream and a function returning the exit code
   */
  async execInteractive(
    containerNameOrId: string,
    options: { cmd: string[]; user?: string; workingDir?: string; cols?: number; rows?: number }
  ): Promise<{ stream: stream.Duplex; exitCode: () => Promise<number> }> {
    const container = this.docker.getContainer(containerNameOrId);

    const exec = await container.exec({
      Cmd: options.cmd,
      User: options.user,
      WorkingDir: options.workingDir,
      Env: ["TERM=xterm-256color"],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });

    const execStream = await exec.start({ hijack: true, stdin: true, Tty: true });

    await exec
      .resize({ h: options.rows ?? 30, w: options.cols ?? 80 })
      .catch(() => undefined);

    return {
      stream: execStream,
      exitCode: async () => (await exec.inspect()).ExitCode ?? 0,
    };
  }

  /**
   * Returns the last log lines of a container, stdout and stderr merged in
   * order, with timestamps.
   */
  async logs(containerId: string, options: { tail: number; since?: number }): Promise<string> {
    const container = this.docker.getContainer(containerId);
    const [info, raw] = await Promise.all([
      container.inspect(),
      container.logs({ stdout: true, stderr: true, tail: options.tail, since: options.since, timestamps: true, follow: false }),
    ]);
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as unknown as string);
    return info.Config.Tty ? buffer.toString("utf8") : demuxLogs(buffer);
  }

  /**
   * Attaches a container to a network; does nothing if it already is.
   */
  async connectNetwork(network: string, container: string): Promise<void> {
    try {
      await this.docker.getNetwork(network).connect({ Container: container });
    } catch (error) {
      if (!/already exists|already attached/i.test(error.message)) {
        throw error;
      }
    }
  }

  /**
   * Detaches a container from a network; does nothing if it is not attached
   * or if the network is gone.
   */
  async disconnectNetwork(network: string, container: string): Promise<void> {
    try {
      await this.docker.getNetwork(network).disconnect({ Container: container, Force: true });
    } catch (error) {
      if (!/not connected|no such network|not found/i.test(error.message)) {
        throw error;
      }
    }
  }

  async getContainerStats(containerId: string): Promise<{
    cpuPercent: number;
    memoryUsage: number;
    memoryLimit: number;
  } | null> {
    try {
      const stats = await this.docker.getContainer(containerId).stats({ stream: false });
      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
      const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
      const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100 : 0;
      return {
        cpuPercent: Math.round(cpuPercent * 10) / 10,
        memoryUsage: stats.memory_stats.usage || 0,
        memoryLimit: stats.memory_stats.limit || 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Sums CPU and memory over the running containers of an environment.
   */
  async getEnvironmentStats(environmentId: string): Promise<{
    totalCpu: number;
    totalMemoryUsage: number;
    totalMemoryLimit: number;
    containers: Array<{ name: string; cpuPercent: number; memoryUsage: number; memoryLimit: number }>;
  }> {
    const running = (await this.listEnvironmentContainers(environmentId)).filter((info) => info.State === "running");
    const containers = [];
    for (const info of running) {
      const stats = await this.getContainerStats(info.Id);
      if (stats) {
        containers.push({ name: info.Labels[LABEL_COMPOSE_SERVICE] ?? info.Names[0].replace("/", ""), ...stats });
      }
    }
    return {
      totalCpu: Math.round(containers.reduce((sum, item) => sum + item.cpuPercent, 0) * 10) / 10,
      totalMemoryUsage: containers.reduce((sum, item) => sum + item.memoryUsage, 0),
      totalMemoryLimit: containers.reduce((sum, item) => sum + item.memoryLimit, 0),
      containers,
    };
  }
}

/**
 * Collects a stream into memory up to a byte cap, then drops the rest.
 */
class CappedBuffer {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  truncated = false;

  constructor(private readonly max: number) {}

  writable(): stream.Writable {
    return new stream.Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        const room = this.max - this.size;
        if (room > 0) {
          const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
          this.chunks.push(slice);
          this.size += slice.length;
        }
        if (chunk.length > room) {
          this.truncated = true;
        }
        callback();
      },
    });
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

/**
 * Decodes the multiplexed log format of containers without a TTY: frames of
 * an 8-byte header (stream type, 3 zero bytes, big-endian length) followed by
 * the payload.
 */
export function demuxLogs(buffer: Buffer): string {
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset + 4);
    parts.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 8 + length;
  }
  return Buffer.concat(parts).toString("utf8");
}
