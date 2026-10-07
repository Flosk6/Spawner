import { Controller, Get, Header, Injectable, NotFoundException, OnModuleInit, Param, Query } from "@nestjs/common";
import type { TerminalSession } from "@prisma/client";
import * as fs from "fs";
import { describeActor, type Actor } from "../../common/actor";
import { Scopes } from "../../common/auth.guard";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../engine/storage.service";

/** The most a recording keeps of a session. */
export const MAX_RECORDING_BYTES = 2 * 1024 * 1024;

export type TerminalEndReason = "exit" | "idle" | "max_duration" | "closed" | "error" | "interrupted";

/**
 * Records what a terminal session shows (the commands typed are echoed in
 * it, passwords typed without echo are not), up to 2 MiB.
 */
export class TerminalRecorder {
  private bytes = 0;
  private truncated = false;
  private readonly file: fs.WriteStream;
  private closed = false;

  constructor(
    readonly sessionId: string,
    filePath: string,
    private readonly onClose: (summary: { reason: TerminalEndReason; exitCode: number | null; bytes: number; truncated: boolean }) => Promise<void>,
    private readonly max = MAX_RECORDING_BYTES,
  ) {
    this.file = fs.createWriteStream(filePath, { flags: "a", mode: 0o600 });
    this.file.on("error", () => undefined);
  }

  write(text: string): void {
    if (this.truncated || this.closed) {
      return;
    }
    const chunk = Buffer.from(text, "utf8");
    const room = this.max - this.bytes;
    if (chunk.length > room) {
      this.file.write(chunk.subarray(0, room));
      this.file.write(`\n[recording stopped at ${this.max >= 1024 * 1024 ? `${this.max / 1024 / 1024} MiB` : `${this.max} bytes`}]\n`);
      this.bytes = this.max;
      this.truncated = true;
      return;
    }
    this.file.write(chunk);
    this.bytes += chunk.length;
  }

  async close(reason: TerminalEndReason, exitCode: number | null = null): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await new Promise<void>((resolve) => this.file.end(() => resolve()));
    await this.onClose({ reason, exitCode, bytes: this.bytes, truncated: this.truncated });
  }
}

/**
 * Terminal sessions: who opened a terminal where, how it ended, and its
 * recording, kept 30 days for the admins.
 */
@Injectable()
export class TerminalSessionsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Sessions still open when Spawner stopped ended with it.
   */
  async onModuleInit(): Promise<void> {
    await this.prisma.terminalSession.updateMany({ where: { endedAt: null }, data: { endedAt: new Date(), endReason: "interrupted" } }).catch(() => undefined);
  }

  async open(actor: Actor, environment: { id: string; label: string }, service: string): Promise<TerminalRecorder> {
    const session = await this.prisma.terminalSession.create({
      data: { environmentId: environment.id, environment: environment.label.slice(0, 60), service, userId: actor.user?.id ?? null, actor: describeActor(actor) },
    });
    return new TerminalRecorder(session.id, this.storage.terminalRecordingPath(session.id), async ({ reason, exitCode, bytes, truncated }) => {
      await this.prisma.terminalSession
        .update({ where: { id: session.id }, data: { endedAt: new Date(), endReason: reason, exitCode, recordedBytes: bytes, truncated } })
        .catch(() => undefined);
    });
  }

  async list(options: { limit?: number; before?: string }) {
    const sessions = await this.prisma.terminalSession.findMany({
      where: options.before ? { startedAt: { lt: (await this.find(options.before)).startedAt } } : {},
      orderBy: { startedAt: "desc" },
      take: Math.min(Math.max(options.limit ?? 50, 1), 200),
    });
    return sessions.map(present);
  }

  recording(id: string): Promise<string> {
    return this.find(id).then(() => fs.promises.readFile(this.storage.terminalRecordingPath(id), "utf8").catch(() => ""));
  }

  private async find(id: string): Promise<TerminalSession> {
    const session = await this.prisma.terminalSession.findUnique({ where: { id } });
    if (!session) {
      throw new NotFoundException(`terminal session "${id}" not found`);
    }
    return session;
  }
}

function present(session: TerminalSession) {
  return {
    id: session.id,
    environmentId: session.environmentId,
    environment: session.environment,
    service: session.service,
    actor: session.actor,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    endReason: session.endReason,
    exitCode: session.exitCode,
    recordedBytes: session.recordedBytes,
    truncated: session.truncated,
  };
}

/**
 * Terminal sessions and their recordings, for the admins.
 */
@Controller("v1/terminals")
@Scopes("admin")
export class TerminalSessionsController {
  constructor(private readonly sessions: TerminalSessionsService) {}

  @Get()
  list(@Query("limit") limit?: string, @Query("before") before?: string) {
    return this.sessions.list({ limit: limit ? Number(limit) || 50 : 50, before });
  }

  /**
   * What the session showed, as plain text with its terminal escape codes.
   */
  @Get(":id/recording")
  @Header("Content-Type", "text/plain; charset=utf-8")
  @Header("X-Content-Type-Options", "nosniff")
  recording(@Param("id") id: string) {
    return this.sessions.recording(id);
  }
}
