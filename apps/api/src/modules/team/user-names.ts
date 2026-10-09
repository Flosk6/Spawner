import { BadRequestException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";

const MAX_NAME = 60;

/**
 * A name a user may go by: 1 to 60 characters, without control characters,
 * and without " via ", which the audit trail and the dashboard put between
 * a user and their token ("Ada via claude-laptop").
 *
 * @returns The trimmed name
 * @throws BadRequestException with what is wrong
 */
export function checkedName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length === 0 || name.length > MAX_NAME) {
    throw new BadRequestException(`a name has 1 to ${MAX_NAME} characters`);
  }
  if (/[\p{Cc}\p{Cf}]/u.test(name) || / via /i.test(name)) {
    throw new BadRequestException('a name has no control characters, nor " via "');
  }
  return name;
}

/**
 * Refuses a name another user already goes by, whatever its case, active
 * or not: names are what the dashboard and the audit trail show, so that
 * nobody can pass for someone else there.
 *
 * @param userId - The user taking the name, when they have an account already
 * @throws ConflictException when the name is taken
 */
export async function assertNameFree(prisma: PrismaService, name: string, userId?: number): Promise<void> {
  const other = await prisma.user.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(userId !== undefined ? { NOT: { id: userId } } : {}) },
    select: { id: true },
  });
  if (other) {
    throw new ConflictException(`someone is already named "${name}": choose another name`);
  }
}

/**
 * The first free name among name, "name (2)", "name (3)"...: for accounts
 * Spawner creates itself, from a GitHub login.
 */
export async function freeName(prisma: PrismaService, wanted: string): Promise<string> {
  const base = wanted.slice(0, MAX_NAME - 5);
  for (let attempt = 1; ; attempt++) {
    const name = attempt === 1 ? wanted.slice(0, MAX_NAME) : `${base} (${attempt})`;
    const taken = await prisma.user.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } });
    if (!taken) {
      return name;
    }
  }
}
