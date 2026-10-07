import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { InvitesService } from "./invites.service";

const FIRST_ADMIN_HOURS = 1;

/**
 * As long as Spawner has no active admin, every start prints an invitation
 * to create the first admin account, valid one hour. Only people who can
 * read the server's logs see it.
 */
@Injectable()
export class FirstAdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FirstAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invites: InvitesService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if ((await this.prisma.user.count({ where: { role: "admin", isActive: true } })) > 0) {
      return;
    }
    const invite = await this.invites.create(null, { role: "admin", note: "first admin", ttlHours: FIRST_ADMIN_HOURS });
    this.logger.warn(`No admin yet. Create the first admin account within ${FIRST_ADMIN_HOURS} hour: ${invite.url}`);
  }
}
