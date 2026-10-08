import { Logger } from "@nestjs/common";
import { OnModuleDestroy } from "@nestjs/common";
import { ConnectedSocket, MessageBody, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, type GatewayMetadata } from "@nestjs/websockets";
import { TERMINAL_INPUT_CHUNK } from "@spawner/core";
import type { IncomingMessage } from "http";
import type { Namespace, Socket } from "socket.io";
import { StringDecoder } from "string_decoder";
import type { Duplex } from "stream";
import { ROLE_SCOPES, assertCanAct, isRole, type Actor } from "../../common/actor";
import { DockerService } from "../../common/docker.service";
import { PrismaService } from "../../common/prisma.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { AuditService } from "../audit/audit.service";
import { WsTicketsService, type TicketHolder } from "../auth/ws-tickets.service";
import { TerminalSessionsService, type TerminalEndReason, type TerminalRecorder } from "./terminal-sessions.service";
import { ActivityService } from "../lifecycle/activity.service";

const MAX_TERMINALS_PER_USER = 3;
const IDLE_LIMIT_MS = 15 * 60_000;
const DURATION_LIMIT_MS = 4 * 3600_000;
const LIMITS_CHECK_MS = 30_000;
/** bash when the image has it, sh otherwise. */
const SHELL = ["/bin/sh", "-c", "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi"];

/**
 * Options of the Socket.IO server (this gateway is its only one), chosen to
 * keep small what a client reaches before it is authenticated: WebSocket
 * only (no long-polling), no client bundle served, 10 seconds to join a
 * namespace, and 64 KiB per message instead of 1 MB. The largest message a
 * client sends is a terminal-input piece of TERMINAL_INPUT_CHUNK code units,
 * under 25 KiB with its envelope however it is escaped; a larger message
 * closes the connection.
 */
export const TERMINAL_SOCKET_OPTIONS = {
  namespace: "terminal",
  transports: ["websocket"],
  serveClient: false,
  connectTimeout: 10_000,
  maxHttpBufferSize: 64 * 1024,
} satisfies GatewayMetadata;

/** The handshake request of a connection, with the ticket it redeemed. */
type TicketRequest = IncomingMessage & { spawnerTicket?: TicketHolder };

interface TerminalSession {
  environmentId: string;
  service: string;
  stream: Duplex;
  userId: number;
  resize: (cols: number, rows: number) => Promise<void>;
  recorder: TerminalRecorder;
  client: Socket;
  startedAt: number;
  lastInputAt: number;
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
 * sends no Origin; a page always does), both checked before the WebSocket
 * opens: a refused client never gets a connection. A terminal
 * opens only in an environment the user may run commands in (their own, or
 * any for an admin), within the project of the token that asked for the
 * ticket, and is recorded in the audit trail. A person has 3 terminals at
 * most; a terminal closes after 15 minutes without input and after 4 hours;
 * what it shows is recorded (2 MiB) for the admins.
 */
@WebSocketGateway(TERMINAL_SOCKET_OPTIONS)
export class TerminalGateway implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy {
  private readonly logger = new Logger(TerminalGateway.name);
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly limits: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: WsTicketsService,
    private readonly docker: DockerService,
    private readonly config: SpawnerConfig,
    private readonly audit: AuditService,
    private readonly recordings: TerminalSessionsService,
    private readonly activity: ActivityService,
  ) {
    this.limits = setInterval(() => this.enforceLimits(), LIMITS_CHECK_MS);
    this.limits.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.limits);
  }

  /**
   * Closes the terminals idle for 15 minutes or open for 4 hours.
   */
  enforceLimits(now = Date.now()): void {
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastInputAt > IDLE_LIMIT_MS) {
        session.client.emit("terminal-error", "Closed after 15 minutes without input");
        this.close(sessionId, "idle");
      } else if (now - session.startedAt > DURATION_LIMIT_MS) {
        session.client.emit("terminal-error", "Closed after 4 hours: open a new terminal");
        this.close(sessionId, "max_duration");
      }
    }
  }

  /**
   * Checks each connection before its WebSocket opens, so that a client
   * without a ticket gets no connection to send anything on, then
   * authenticates it when it joins /terminal, before any message (a client
   * may send start-terminal as soon as it is connected). The main namespace
   * serves nothing. A refused namespace connection closes the connection:
   * one connection, one attempt.
   */
  afterInit(namespace: Namespace): void {
    namespace.server.engine.opts.allowRequest = (request, callback) => {
      const refusal = this.admit(request as TicketRequest);
      callback(refusal, refusal === null);
    };
    namespace.server.use((client, next) => this.refuse(client, next, new Error("terminals are in the /terminal namespace")));
    namespace.use((client, next) => {
      this.authenticate(client).then(
        (actor) => {
          client.data.actor = actor;
          next();
        },
        (error: Error) => {
          this.logger.warn(`Terminal connection refused: ${error.message}`);
          this.refuse(client, next, error);
        },
      );
    });
  }

  /**
   * Lets a connection open only from the dashboard's origin (or without
   * one: the CLI) and with a valid ticket, which it redeems for the
   * namespace middleware.
   *
   * @returns null when the connection may open, the reason otherwise
   */
  private admit(request: TicketRequest): string | null {
    const origin = request.headers.origin;
    if (origin && !this.config.dashboardOrigins.includes(origin)) {
      return "terminals open from the dashboard or the CLI only";
    }
    const holder = this.tickets.redeem(new URL(request.url ?? "/", "http://localhost").searchParams.get("token"));
    if (!holder) {
      return "Unauthorized: invalid or expired ticket";
    }
    request.spawnerTicket = holder;
    return null;
  }

  /**
   * Refuses a namespace connection, then closes the connection once the
   * refusal is sent (Socket.IO writes it on the next tick).
   */
  private refuse(client: Socket, next: (error?: Error) => void, error: Error): void {
    next(error);
    setImmediate(() => client.conn.close());
  }

  private async authenticate(client: Socket): Promise<Actor> {
    const holder = (client.request as TicketRequest).spawnerTicket;
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
        this.close(sessionId, "closed");
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
        cmd: SHELL,
        cols: dimension(data.cols, 80),
        rows: dimension(data.rows, 30),
      });
      const sessionId = `${client.id}:${data.resourceName}`;
      this.close(sessionId, "closed");
      const label = `${environment.project.slug}/${environment.slug}`;
      const recorder = await this.recordings.open(actor, { id: environment.id, label }, data.resourceName);
      this.activity.touch(environment.id);
      const now = Date.now();
      this.sessions.set(sessionId, {
        environmentId: environment.id,
        service: data.resourceName,
        stream,
        userId: actor.user.id,
        resize,
        recorder,
        client,
        startedAt: now,
        lastInputAt: now,
      });
      await this.audit.record(actor, "terminal.open", { target: label, details: { service: data.resourceName, sessionId: recorder.sessionId } });

      const decoder = new StringDecoder("utf8");
      stream.on("data", (chunk: Buffer) => {
        const text = decoder.write(chunk);
        recorder.write(text);
        client.emit("terminal-output", text);
      });
      stream.on("end", async () => {
        const code = await exitCode().catch(() => 0);
        client.emit("terminal-exit", code);
        this.close(sessionId, "exit", code);
      });
      stream.on("error", () => {
        client.emit("terminal-error", "Terminal session lost");
        this.close(sessionId, "error");
      });
      client.emit("terminal-output", `\r\n\x1b[1;32mConnected to ${data.resourceName}\x1b[0m\r\n\r\n`);
    } catch (error) {
      this.logger.error(`Could not start a terminal: ${(error as Error).message}`);
      client.emit("terminal-error", "Failed to start terminal");
    }
  }

  /**
   * Writes what is typed to the shell. Clients split a large paste into
   * pieces of TERMINAL_INPUT_CHUNK code units at most (a longer one is
   * ignored); the pieces arrive in order on the one WebSocket, and this
   * handler, synchronous, writes them to the shell in that order.
   */
  @SubscribeMessage("terminal-input")
  input(@ConnectedSocket() client: Socket, @MessageBody() data: { input?: string; resourceName?: string }): void {
    const session = this.sessions.get(`${client.id}:${data?.resourceName}`);
    if (!session) {
      client.emit("terminal-error", "No active terminal session");
      return;
    }
    if (typeof data.input !== "string" || data.input.length > TERMINAL_INPUT_CHUNK) {
      return;
    }
    session.lastInputAt = Date.now();
    try {
      session.stream.write(data.input);
    } catch {
      client.emit("terminal-error", "Terminal session lost");
      this.close(`${client.id}:${data.resourceName}`, "error");
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
    this.close(`${client.id}:${data?.resourceName}`, "closed");
  }

  private close(sessionId: string, reason: TerminalEndReason, exitCode: number | null = null): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    this.sessions.delete(sessionId);
    void session.recorder.close(reason, exitCode);
    try {
      session.stream.end();
      session.stream.destroy();
    } catch (error) {
      this.logger.warn(`Error closing terminal stream: ${(error as Error).message}`);
    }
  }
}
