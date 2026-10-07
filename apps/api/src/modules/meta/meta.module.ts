import { Controller, Get, Module, NotFoundException, Res } from "@nestjs/common";
import type { Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { Public } from "../../common/auth.guard";
import { SpawnerConfig } from "../../common/spawner.config";
import { EXEC_MAX_OUTPUT_BYTES, EXEC_MAX_SECONDS, EXEC_MAX_STDIN_BYTES, MIN_TTL_SECONDS } from "../environments/environments.service";
import { SHARE_DEFAULT_HOURS, SHARE_MAX_HOURS } from "../previews/shares.service";

/**
 * Version of this Spawner, from the API's package.json (next to dist/ in
 * development and in the image).
 */
function readVersion(): string {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", "..", "package.json"), "utf8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

const VERSION = readVersion();

/**
 * The CLI bundle served for download: SPAWNER_CLI_PATH in the image, the
 * build of apps/cli in development.
 */
function cliPath(): string {
  return process.env.SPAWNER_CLI_PATH || path.resolve(__dirname, "..", "..", "..", "..", "cli", "dist", "spawner.cjs");
}

/**
 * What the installation is (version, domain, limits), so that the CLI checks
 * a deploy locally with the same rules as the server; and the CLI itself.
 */
@Controller("v1")
export class MetaController {
  constructor(private readonly config: SpawnerConfig) {}

  @Get("info")
  info() {
    return {
      version: VERSION,
      dashboardUrl: this.config.dashboardUrl,
      previewDomain: this.config.previewDomain,
      scheme: this.config.scheme,
      limits: {
        compose: { ...this.config.composeLimits, envMemoryMaxBytes: this.config.envMemoryMaxBytes },
        upload: {
          maxBytes: this.config.uploadMaxBytes,
          maxFiles: this.config.uploadMaxFiles,
          maxExtractedBytes: this.config.uploadMaxExtractedBytes,
        },
        ttl: { defaultSeconds: this.config.envTtlSeconds, minSeconds: MIN_TTL_SECONDS, maxSeconds: this.config.envTtlMaxSeconds },
        exec: { maxSeconds: EXEC_MAX_SECONDS, maxOutputBytes: EXEC_MAX_OUTPUT_BYTES, maxStdinBytes: EXEC_MAX_STDIN_BYTES },
        share: { defaultHours: SHARE_DEFAULT_HOURS, maxHours: SHARE_MAX_HOURS },
      },
    };
  }

  /**
   * The CLI, one JavaScript file (CommonJS) that needs Node.js 20 or later:
   * curl -fsSL <dashboard>/api/v1/cli/spawner -o ~/.local/bin/spawner
   */
  @Public()
  @Get("cli/spawner")
  cli(@Res() response: Response) {
    const file = cliPath();
    if (!fs.existsSync(file)) {
      throw new NotFoundException("the CLI is not built into this installation");
    }
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("X-Spawner-Version", VERSION);
    response.sendFile(file);
  }
}

@Module({ controllers: [MetaController] })
export class MetaModule {}
