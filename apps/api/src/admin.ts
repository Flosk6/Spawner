import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { config } from "dotenv";
import { join } from "path";
import { isRole } from "./common/actor";
import { PrismaModule } from "./common/prisma.module";
import { SpawnerConfigModule } from "./common/spawner-config.module";
import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { INVITE_DEFAULT_HOURS, InvitesService } from "./modules/team/invites.service";

config({ path: join(__dirname, "..", "..", "..", ".env") });

const USAGE = `Usage: node dist/admin.js invite [--role admin|member] [--hours N] [--note text]

Prints a one-time invitation link (default: member, ${INVITE_DEFAULT_HOURS} hours).
In the container: docker exec -u node spawner node dist/admin.js invite --role admin`;

@Module({
  imports: [SpawnerConfigModule, PrismaModule, AuditModule, AuthModule],
  providers: [InvitesService],
})
class AdminModule {}

/**
 * Administration commands that need no account, for the installer and for
 * whoever operates the server.
 */
async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== "invite") {
    console.error(USAGE);
    return 2;
  }
  const options: Record<string, string> = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      console.error(USAGE);
      return 2;
    }
    options[flag.slice(2)] = value;
  }
  const role = options.role ?? "member";
  if (!isRole(role)) {
    console.error('--role must be "admin" or "member"');
    return 2;
  }

  const app = await NestFactory.createApplicationContext(AdminModule, { logger: ["error", "warn"] });
  try {
    const invite = await app.get(InvitesService).create(null, {
      role,
      note: options.note ?? `${role} invited from the command line`,
      ttlHours: options.hours === undefined ? undefined : Number(options.hours),
    });
    console.log(invite.url);
    return 0;
  } finally {
    await app.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: Error) => {
    console.error(error.message);
    process.exit(1);
  },
);
