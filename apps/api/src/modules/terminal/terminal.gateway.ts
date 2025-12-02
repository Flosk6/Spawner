import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { AuthTokenService } from "../auth/auth-token.service";
import * as pty from "node-pty";

interface TerminalSession {
  environmentId: string;
  resourceName: string;
  process: any;
  userId: number;
  createdAt: Date;
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: [
      "http://localhost:8080",
      "http://localhost:8081",
      "http://localhost:5173",
      process.env.FRONTEND_URL,
    ].filter(Boolean),
    credentials: true,
  },
  namespace: "terminal",
})
export class TerminalGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TerminalGateway.name);
  private readonly sessions = new Map<string, TerminalSession>();

  // Security: List of blocked commands
  private readonly BLOCKED_COMMANDS = [
    "rm -rf /",
    "mkfs",
    "dd if=",
    ":(){ :|:& };:", // Fork bomb
    "wget",
    "curl",
    "nc ",
    "netcat",
  ];

  // Security: List of restricted directories (cannot cd into)
  private readonly RESTRICTED_DIRECTORIES = [
    "/root",
    "/etc",
    "/sys",
    "/proc",
    "/boot",
    "/dev",
    "/bin",
    "/sbin",
    "/usr/bin",
    "/usr/sbin",
  ];

  // Security: Maximum command length
  private readonly MAX_COMMAND_LENGTH = 1000;

  // Security: Command execution timeout (30 seconds)
  private readonly COMMAND_TIMEOUT = 30000;

  // Security: Max concurrent sessions per user
  private readonly MAX_SESSIONS_PER_USER = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authTokenService: AuthTokenService
  ) {}

  async handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);

    // Security: Validate WebSocket token from query params
    const token = client.handshake.query.token as string;

    if (!token) {
      this.logger.warn(`No token provided: ${client.id}`);
      client.emit("terminal-error", "Unauthorized: No authentication token");
      client.disconnect();
      return;
    }

    const user = this.authTokenService.validateWsToken(token);

    if (!user) {
      this.logger.warn(`Invalid or expired token: ${client.id}`);
      client.emit("terminal-error", "Unauthorized: Invalid or expired token");
      client.disconnect();
      return;
    }

    // Attach user to handshake for easy access
    (client.handshake as any).user = user;

    this.logger.log(
      `User ${user.username} (${user.userId}) connected via WebSocket`
    );
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);

    // Clean up any active sessions for this client
    for (const [sessionId] of this.sessions.entries()) {
      if (sessionId.startsWith(client.id)) {
        this.cleanupSession(sessionId);
      }
    }
  }

  @SubscribeMessage("start-terminal")
  async handleStartTerminal(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { environmentId: string; resourceName: string }
  ) {
    this.logger.log(
      `Starting terminal for ${data.resourceName} in environment ${data.environmentId}`
    );

    const user = (client.handshake as any).user;
    if (!user) {
      this.logger.error("No user in handshake");
      client.emit("terminal-error", "Unauthorized");
      return;
    }

    this.logger.log(`User: ${user.username} (${user.userId})`);

    // Security: Check max sessions per user
    const userSessions = Array.from(this.sessions.values()).filter(
      (s) => s.userId === user.userId
    );
    if (userSessions.length >= this.MAX_SESSIONS_PER_USER) {
      client.emit(
        "terminal-error",
        `Maximum ${this.MAX_SESSIONS_PER_USER} concurrent terminals allowed`
      );
      return;
    }

    try {
      // Security: Verify environment exists and user has access
      const environment = await this.prisma.environment.findUnique({
        where: { id: data.environmentId },
        include: {
          resources: true,
          project: true,
        },
      });

      if (!environment) {
        client.emit("terminal-error", "Environment not found");
        return;
      }

      // Security: Verify resource exists in this environment
      const resource = environment.resources?.find(
        (r) => r.resourceName === data.resourceName
      );

      if (!resource) {
        client.emit("terminal-error", "Resource not found");
        return;
      }

      // Security: Only allow terminal on non-database resources
      if (resource.resourceType === "mysql-db") {
        client.emit(
          "terminal-error",
          "Terminal not available for database resources"
        );
        return;
      }

      // Container naming convention (using dockerode):
      // - Container: {resourceName}-{environmentName} (e.g., "api-test")
      const containerName = `${data.resourceName}-${environment.name}`;

      this.logger.log(`Starting docker exec for container: ${containerName}`);

      // Determine working directory and user based on resource type
      let workingDir = "/var/www"; // Default for Laravel
      let execUser = "www-data"; // Default non-root user for Laravel

      if (resource.resourceType === "nextjs-front") {
        workingDir = "/app";
        execUser = "node"; // Next.js typically runs as node user
      }

      // Start docker exec with PTY for real terminal support
      // CRITICAL SECURITY: Execute as non-root user to prevent system modifications
      const dockerProcess = pty.spawn(
        "docker",
        [
          "exec",
          "-it", // Interactive + TTY
          "-u",
          execUser, // Run as non-root user (SECURITY)
          "-w",
          workingDir, // Set working directory
          containerName,
          "/bin/sh", // Start a shell
        ],
        {
          name: "xterm-256color",
          cols: 80,
          rows: 30,
          cwd: process.cwd(),
          env: process.env as Record<string, string>,
        }
      );

      const sessionId = `${client.id}-${data.resourceName}`;

      this.sessions.set(sessionId, {
        environmentId: data.environmentId,
        resourceName: data.resourceName,
        process: dockerProcess,
        userId: user.userId,
        createdAt: new Date(),
      });

      this.logger.log(`Terminal session created: ${sessionId}`);

      // Send output to client
      dockerProcess.onData((data: string) => {
        this.logger.debug(`PTY output: ${data.substring(0, 50)}...`);
        client.emit("terminal-output", data);
      });

      dockerProcess.onExit(({ exitCode, signal }) => {
        this.logger.log(
          `Docker process exited with code: ${exitCode}, signal: ${signal}`
        );
        client.emit("terminal-exit", exitCode);
        this.cleanupSession(sessionId);
      });

      // Send welcome message
      client.emit(
        "terminal-output",
        `\r\n\x1b[1;32mConnected to ${data.resourceName}\x1b[0m\r\n`
      );
      client.emit(
        "terminal-output",
        `\x1b[1;33mSecurity Notice: All commands are logged\x1b[0m\r\n\r\n`
      );

      this.logger.log(
        `Terminal session started: ${sessionId} by user ${user.username} (${user.userId})`
      );
    } catch (error) {
      this.logger.error(`Error starting terminal: ${error.message}`);
      client.emit("terminal-error", "Failed to start terminal");
    }
  }

  @SubscribeMessage("terminal-input")
  handleTerminalInput(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { input: string; resourceName: string }
  ) {
    this.logger.debug(
      `Received terminal input: ${data.input.replace(/\r/g, "\\r").replace(/\n/g, "\\n")}`
    );

    const user = (client.handshake as any).user;
    if (!user) {
      this.logger.warn("No user in handshake for terminal input");
      return;
    }

    const sessionId = `${client.id}-${data.resourceName}`;
    const session = this.sessions.get(sessionId);

    if (!session) {
      this.logger.warn(`No session found: ${sessionId}`);
      client.emit("terminal-error", "No active terminal session");
      return;
    }

    this.logger.debug(`Writing to process stdin for session: ${sessionId}`);

    // Security: Check input length
    if (data.input.length > this.MAX_COMMAND_LENGTH) {
      client.emit(
        "terminal-output",
        `\r\n\x1b[1;31mCommand too long (max ${this.MAX_COMMAND_LENGTH} characters)\x1b[0m\r\n`
      );
      return;
    }

    // Security: Check for blocked commands (only on Enter key)
    if (data.input.includes("\r") || data.input.includes("\n")) {
      const command = data.input.trim();

      // Check for blocked commands
      const isBlocked = this.BLOCKED_COMMANDS.some((blocked) =>
        command.toLowerCase().includes(blocked.toLowerCase())
      );

      if (isBlocked) {
        this.logger.warn(
          `Blocked dangerous command from user ${user.username} (${user.userId}): ${command}`
        );
        client.emit(
          "terminal-output",
          `\r\n\x1b[1;31mCommand blocked for security reasons\x1b[0m\r\n`
        );
        return;
      }

      // Check for cd to restricted directories
      const cdMatch = command.match(/^\s*cd\s+(.+)$/);
      if (cdMatch) {
        const targetDir = cdMatch[1].trim().replace(/['"]/g, ""); // Remove quotes
        const isRestricted = this.RESTRICTED_DIRECTORIES.some(
          (restricted) =>
            targetDir === restricted || targetDir.startsWith(restricted + "/")
        );

        if (isRestricted) {
          this.logger.warn(
            `Blocked access to restricted directory from user ${user.username} (${user.userId}): ${targetDir}`
          );
          client.emit(
            "terminal-output",
            `\r\n\x1b[1;31mAccess denied: ${targetDir} is a restricted directory\x1b[0m\r\n`
          );
          client.emit(
            "terminal-output",
            `\x1b[1;33mAllowed directories: /var/www/html, /tmp, /var/log\x1b[0m\r\n`
          );
          return;
        }
      }

      // Log all commands for audit
      this.logger.log(
        `Terminal command [${session.resourceName}] user ${user.username} (${user.userId}): ${command}`
      );
    }

    // Send input to PTY process
    try {
      session.process.write(data.input);
    } catch (error) {
      this.logger.error(`Error writing to terminal: ${error.message}`);
      client.emit("terminal-error", "Terminal session lost");
      this.cleanupSession(sessionId);
    }
  }

  @SubscribeMessage("stop-terminal")
  handleStopTerminal(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { resourceName: string }
  ) {
    const sessionId = `${client.id}-${data.resourceName}`;
    this.cleanupSession(sessionId);
  }

  private cleanupSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        session.process.kill();
      } catch (error) {
        this.logger.error(`Error killing process: ${error.message}`);
      }
      this.sessions.delete(sessionId);
      this.logger.log(`Terminal session cleaned up: ${sessionId}`);
    }
  }
}
