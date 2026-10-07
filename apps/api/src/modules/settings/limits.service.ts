import { BadRequestException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { parseDuration, parseSize } from "@spawner/core";
import type { Actor } from "../../common/actor";
import { PrismaService } from "../../common/prisma.service";
import { SpawnerConfig } from "../../common/spawner.config";
import { AuditService } from "../audit/audit.service";

const SETTING_KEY = "limits";
const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const DAY = 86_400;

/**
 * The limits an admin may change from the settings page. Durations are in
 * seconds and sizes in bytes; 0 turns sleeping, the quota or a build guard
 * off.
 */
export interface Limits {
  ttlSeconds: number;
  ttlMaxSeconds: number;
  idleSeconds: number;
  envsPerUser: number;
  envMemoryBytes: number;
  envMemoryMaxBytes: number;
  buildMinFreeMemoryBytes: number;
  buildMinFreeDiskBytes: number;
}

type LimitKey = keyof Limits;

const DURATIONS: LimitKey[] = ["ttlSeconds", "ttlMaxSeconds", "idleSeconds"];
const SIZES: LimitKey[] = ["envMemoryBytes", "envMemoryMaxBytes", "buildMinFreeMemoryBytes", "buildMinFreeDiskBytes"];
const KEYS: LimitKey[] = [...DURATIONS, "envsPerUser", ...SIZES];

/**
 * Lifetimes, sleep, quotas, memory and build guards: the environment sets
 * them at startup, an admin may override them from the settings page. The
 * overrides live in the settings table and are applied to SpawnerConfig, which
 * the engine reads.
 */
@Injectable()
export class LimitsService implements OnModuleInit {
  private readonly logger = new Logger(LimitsService.name);
  /** What the environment of the process sets, before any override. */
  readonly defaults: Limits;
  private overrides: Partial<Limits> = {};

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SpawnerConfig,
    private readonly audit: AuditService,
  ) {
    this.defaults = this.current();
  }

  async onModuleInit(): Promise<void> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEY } }).catch(() => null);
    if (!row) {
      return;
    }
    try {
      this.overrides = this.check(JSON.parse(row.value) as Record<string, unknown>, {});
      this.apply();
    } catch (error) {
      this.logger.warn(`The saved limits were ignored: ${(error as Error).message}`);
    }
  }

  /**
   * The limits in force, what the environment sets, and which ones an admin
   * changed.
   */
  view() {
    return { values: this.current(), defaults: this.defaults, overridden: Object.keys(this.overrides) as LimitKey[] };
  }

  /**
   * Changes some limits. A value given as null goes back to what the
   * environment sets; durations may be given as "72h" and sizes as "2g".
   */
  async update(actor: Actor, input: Record<string, unknown>) {
    const unknown = Object.keys(input).filter((key) => !KEYS.includes(key as LimitKey));
    if (unknown.length > 0) {
      throw new BadRequestException(`unknown limits: ${unknown.join(", ")}`);
    }
    const overrides = this.check(input, this.overrides);
    await this.prisma.setting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: JSON.stringify(overrides) },
      update: { value: JSON.stringify(overrides) },
    });
    this.overrides = overrides;
    this.apply();
    await this.audit.record(actor, "settings.limits", { details: input });
    return this.view();
  }

  /**
   * Merges the input into the current overrides and checks the result as a
   * whole (a lifetime within its maximum, a memory within its maximum).
   */
  private check(input: Record<string, unknown>, base: Partial<Limits>): Partial<Limits> {
    const overrides: Partial<Limits> = { ...base };
    for (const key of KEYS) {
      if (!(key in input)) {
        continue;
      }
      const value = input[key];
      if (value === null) {
        delete overrides[key];
        continue;
      }
      overrides[key] = this.parse(key, value);
    }
    const limits = { ...this.defaults, ...overrides };
    const fail = (message: string) => {
      throw new BadRequestException(message);
    };
    if (limits.ttlSeconds < 600) fail("the lifetime must be at least 10m");
    if (limits.ttlMaxSeconds > 365 * DAY) fail("the maximum lifetime is at most 365d");
    if (limits.ttlSeconds > limits.ttlMaxSeconds) fail("the lifetime must not exceed the maximum lifetime");
    if (limits.idleSeconds !== 0 && limits.idleSeconds < 60) fail("the idle time before sleeping must be at least 1m, or 0 to never sleep");
    if (!Number.isInteger(limits.envsPerUser) || limits.envsPerUser < 0 || limits.envsPerUser > 10_000) fail("environments per person must be a whole number between 0 and 10000");
    if (limits.envMemoryBytes < 64 * MiB) fail("the memory of an environment must be at least 64m");
    if (limits.envMemoryBytes > limits.envMemoryMaxBytes) fail("the memory of an environment must not exceed its maximum");
    if (limits.envMemoryMaxBytes > 1024 * GiB) fail("the memory maximum is at most 1024g");
    if (limits.buildMinFreeMemoryBytes > 1024 * GiB || limits.buildMinFreeDiskBytes > 100 * 1024 * GiB) fail("a build guard is too large");
    return overrides;
  }

  private parse(key: LimitKey, value: unknown): number {
    if (DURATIONS.includes(key)) {
      if (key === "idleSeconds" && (value === "never" || value === 0 || value === "0")) {
        return 0;
      }
      const seconds = typeof value === "number" ? value : parseDuration(value);
      if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
        throw new BadRequestException(`${key} must be a duration such as "2h" or a number of seconds`);
      }
      return Math.round(seconds);
    }
    if (SIZES.includes(key)) {
      if (value === 0 || value === "0") {
        return 0;
      }
      const bytes = typeof value === "number" ? value : parseSize(value);
      if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
        throw new BadRequestException(`${key} must be a size such as "2g" or a number of bytes`);
      }
      return Math.round(bytes);
    }
    const number = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isInteger(number)) {
      throw new BadRequestException(`${key} must be a whole number`);
    }
    return number;
  }

  private current(): Limits {
    return {
      ttlSeconds: this.config.envTtlSeconds,
      ttlMaxSeconds: this.config.envTtlMaxSeconds,
      idleSeconds: this.config.envIdleSeconds,
      envsPerUser: this.config.envsPerUser,
      envMemoryBytes: this.config.composeLimits.envMemoryBytes,
      envMemoryMaxBytes: this.config.envMemoryMaxBytes,
      buildMinFreeMemoryBytes: this.config.minFreeMemoryBytes,
      buildMinFreeDiskBytes: this.config.minFreeDiskBytes,
    };
  }

  private apply(): void {
    const limits = { ...this.defaults, ...this.overrides };
    this.config.envTtlSeconds = limits.ttlSeconds;
    this.config.envTtlMaxSeconds = limits.ttlMaxSeconds;
    this.config.envIdleSeconds = limits.idleSeconds;
    this.config.envsPerUser = limits.envsPerUser;
    this.config.composeLimits.envMemoryBytes = limits.envMemoryBytes;
    this.config.envMemoryMaxBytes = limits.envMemoryMaxBytes;
    this.config.minFreeMemoryBytes = limits.buildMinFreeMemoryBytes;
    this.config.minFreeDiskBytes = limits.buildMinFreeDiskBytes;
  }
}
