import { Logger } from "@nestjs/common";
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway } from "@nestjs/websockets";
import type { Socket } from "socket.io";
import { StringDecoder } from "string_decoder";
import type { Duplex } from "stream";
import { ROLE_SCOPES, assertCanAct, isRole, sessionActor, type Actor } from "../../common/actor";
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
}

/**
 * Interactive terminals in the services of an environment, over Socket.IO:
 * a TTY exec session through the Docker API. A connection needs the
 * dashboard origin and a one-time ticket; a terminal opens only in an
 * environment the user may run commands in (their own, or any for an
 * admin), and is recorded in the audit trail.
 */
@WebSocketGateway({ namespace: "terminal" })
export class TerminalGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(TerminalGateway.name);
  private readonly sessions = new Map<string, TerminalSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: WsTicketsService,
    private readonly docker: DockerService,
    private readonly config: SpawnerConfig,
    private readonly audit: AuditService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const origin = client.handshake.headers.origin;
    if (!origin || !this.config.dashboardOrigins.includes(origin)) {
      client.emit("terminal-error", "Terminals open from the dashboard only");
      client.disconnect(true);
      return;
    }
    const userId = this.tickets.redeem(client.handshake.query.token ?? client.handshake.auth?.token);
    const user = userId ? await this.prisma.user.findUnique({ where: { id: userId } }) : null;
    if (!user?.isActive || !isRole(user.role)) {
      client.emit("terminal-error", "Unauthorized: invalid or expired ticket");
      client.disconnect(true);
      return;
    }
    client.data.actor = sessionActor({ id: user.id, name: user.name, role: user.role });
  }

  handleDisconnect(client: Socket): void {
    for (const sessionId of this.sessions.keys()) {
      if (sessionId.startsWith(`${client.id}:`)) {
        this.close(sessionId);
      }
    }
  }

  @SubscribeMessage("start-terminal")
  async start(@ConnectedSocket() client: Socket, @MessageBody() data: { environmentId?: string; resourceName?: string }): Promise<void> {
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
      assertCanAct({ ...actor, scopes: ROLE_SCOPES[actor.user.role] }, "envs:exec", environment);
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
      const { stream, exitCode } = await this.docker.execInteractive(container.Id, { cmd: ["/bin/sh"] });
      const sessionId = `${client.id}:${data.resourceName}`;
      this.close(sessionId);
      this.sessions.set(sessionId, { environmentId: environment.id, service: data.resourceName, stream, userId: actor.user.id });
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
