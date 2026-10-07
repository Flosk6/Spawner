import { Logger } from "@nestjs/common";
import { ConnectedSocket, MessageBody, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway } from "@nestjs/websockets";
import type { Namespace, Socket } from "socket.io";
import { StringDecoder } from "string_decoder";
import type { Duplex } from "stream";
import { ROLE_SCOPES, assertCanAct, isRole, type Actor } from "../../common/actor";
import { DockerService } from "../../common/docker.service";
import { PrismaService } from "../../common/prisma.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { AuditService } from "../audit/audit.service";
import { WsTicketsService } from "../auth/ws-tickets.service";

const MAX_TERMINALS_PER_USER = 3;
const MAX_INPUT_LENGTH = 4096;

interface TerminalSession {
  environmentId: string;
  service: string;
  stream: Duplex;
  userId: number;
  resize: (cols: number, rows: number) => Promise<void>;
}

/**
 * Accepts a terminal size within reason.
 */
function dimension(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 10 && value <= 1000 ? value : fallback;
}

/**
 * Interactive terminals in the services of an environment, over Socket.IO:
 * a TTY exec session through the Docker API. A connection needs a one-time
 * ticket, and the dashboard origin when it comes from a browser (the CLI
 * sends no Origin; a page always does), both checked during the handshake:
 * a refused client gets a connect_error and never connects. A terminal
 * opens only in an environment the user may run commands in (their own, or
 * any for an admin), within the project of the token that asked for the
 * ticket, and is recorded in the audit trail.
 */
@WebSocketGateway({ namespace: "terminal" })
export class TerminalGateway implements OnGatewayInit, OnGatewayDisconnect {
  private readonly logger = new Logger(TerminalGateway.name);
  private readonly sessions = new Map<string, TerminalSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: WsTicketsService,
    private readonly docker: DockerService,
    private readonly config: SpawnerConfig,
    private readonly audit: AuditService,
  ) {}

  /**
   * Authenticates each connection during its handshake, so that no message
   * arrives before the actor is known (a client may send start-terminal as
   * soon as it is connected).
   */
  afterInit(namespace: Namespace): void {
    namespace.use((client, next) => {
      this.authenticate(client).then(
        (actor) => {
          client.data.actor = actor;
          next();
        },
        (error: Error) => {
          this.logger.warn(`Terminal connection refused: ${error.message}`);
          next(error);
        },
      );
    });
  }

  private async authenticate(client: Socket): Promise<Actor> {
    const origin = client.handshake.headers.origin;
    if (origin && !this.config.dashboardOrigins.includes(origin)) {
      throw new Error("terminals open from the dashboard or the CLI only");
    }
    const holder = this.tickets.redeem(client.handshake.query.token ?? client.handshake.auth?.token);
    const user = holder?.userId ? await this.prisma.user.findUnique({ where: { id: holder.userId } }) : null;
    if (!holder || !user?.isActive || !isRole(user.role)) {
      throw new Error("Unauthorized: invalid or expired ticket");
    }
    const roleScopes = ROLE_SCOPES[user.role];
    return {
      user: { id: user.id, name: user.name, role: user.role },
      via: holder.via,
      scopes: holder.scopes.filter((scope) => roleScopes.includes(scope)),
      tokenId: holder.tokenId,
      tokenName: holder.tokenName,
      projectId: holder.projectId,
    };
  }

  handleDisconnect(client: Socket): void {
    for (const sessionId of this.sessions.keys()) {
      if (sessionId.startsWith(`${client.id}:`)) {
        this.close(sessionId);
      }
    }
  }

  @SubscribeMessage("start-terminal")
  async start(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { environmentId?: string; resourceName?: string; cols?: number; rows?: number },
  ): Promise<void> {
    const actor = client.data.actor as Actor | undefined;
    if (!actor?.user || typeof data?.environmentId !== "string" || typeof data.resourceName !== "string") {
      client.emit("terminal-error", "Unauthorized");
      return;
    }
    if ([...this.sessions.values()].filter((session) => session.userId === actor.user?.id).length >= MAX_TERMINALS_PER_USER) {
      client.emit("terminal-error", `At most ${MAX_TERMINALS_PER_USER} terminals at once`);
      return;
    }

    const environment = await this.prisma.environment.findFirst({ where: { id: data.environmentId, deletedAt: null }, include: { project: true } });
    if (!environment) {
      client.emit("terminal-error", "Environment not found");
      return;
    }
    try {
      assertCanAct(actor, "envs:exec", environment);
    } catch (error) {
      client.emit("terminal-error", (error as Error).message);
      return;
    }
    const container = await this.docker.findServiceContainer(environment.id, data.resourceName);
    if (!container || container.State !== "running") {
      client.emit("terminal-error", `Service "${data.resourceName}" is not running`);
      return;
    }

    try {
      const { stream, exitCode, resize } = await this.docker.execInteractive(container.Id, {
        cmd: ["/bin/sh"],
        cols: dimension(data.cols, 80),
        rows: dimension(data.rows, 30),
      });
      const sessionId = `${client.id}:${data.resourceName}`;
      this.close(sessionId);
      this.sessions.set(sessionId, { environmentId: environment.id, service: data.resourceName, stream, userId: actor.user.id, resize });
      await this.audit.record(actor, "terminal.open", { target: `${environment.project.slug}/${environment.slug}`, details: { service: data.resourceName } });

      const decoder = new StringDecoder("utf8");
      stream.on("data", (chunk: Buffer) => client.emit("terminal-output", decoder.write(chunk)));
      stream.on("end", async () => {
        client.emit("terminal-exit", await exitCode().catch(() => 0));
        this.close(sessionId);
      });
      stream.on("error", () => {
        client.emit("terminal-error", "Terminal session lost");
        this.close(sessionId);
      });
      client.emit("terminal-output", `\r\n\x1b[1;32mConnected to ${data.resourceName}\x1b[0m\r\n\r\n`);
    } catch (error) {
      this.logger.error(`Could not start a terminal: ${(error as Error).message}`);
      client.emit("terminal-error", "Failed to start terminal");
    }
  }

  @SubscribeMessage("terminal-input")
  input(@ConnectedSocket() client: Socket, @MessageBody() data: { input?: string; resourceName?: string }): void {
    const session = this.sessions.get(`${client.id}:${data?.resourceName}`);
    if (!session) {
      client.emit("terminal-error", "No active terminal session");
      return;
    }
    if (typeof data.input !== "string" || data.input.length > MAX_INPUT_LENGTH) {
      return;
    }
    try {
      session.stream.write(data.input);
    } catch {
      client.emit("terminal-error", "Terminal session lost");
      this.close(`${client.id}:${data.resourceName}`);
    }
  }

  /**
   * Follows the size of the client's terminal.
   */
  @SubscribeMessage("terminal-resize")
  resize(@ConnectedSocket() client: Socket, @MessageBody() data: { resourceName?: string; cols?: number; rows?: number }): void {
    const session = this.sessions.get(`${client.id}:${data?.resourceName}`);
    if (session) {
      void session.resize(dimension(data.cols, 80), dimension(data.rows, 30));
    }
  }

  @SubscribeMessage("stop-terminal")
  stop(@ConnectedSocket() client: Socket, @MessageBody() data: { resourceName?: string }): void {
    this.close(`${client.id}:${data?.resourceName}`);
  }

  private close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    this.sessions.delete(sessionId);
    try {
      session.stream.end();
      session.stream.destroy();
    } catch (error) {
      this.logger.warn(`Error closing terminal stream: ${(error as Error).message}`);
    }
  }
}
