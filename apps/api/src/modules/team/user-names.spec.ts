import { describe, expect, it } from "vitest";
import type { PrismaService } from "../../common/prisma.service";
import { checkedName, freeName } from "./user-names";

describe("user names", () => {
  it("are 1 to 60 characters, without control characters or what the audit trail puts between a user and a token", () => {
    expect(checkedName("  Ada Lovelace ")).toBe("Ada Lovelace");
    expect(checkedName("Olivia")).toBe("Olivia");
    for (const name of ["", "   ", "a".repeat(61), "Ada\nAdmin", "Ada​", "Ada via ci", "Ada VIA ci", 42]) {
      expect(() => checkedName(name)).toThrow();
    }
  });

  it("gives an account Spawner creates the first name nobody goes by", async () => {
    const taken = new Set(["ada", "ada (2)"]);
    const prisma = { user: { findFirst: async ({ where }: { where: { name: { equals: string } } }) => (taken.has(where.name.equals.toLowerCase()) ? { id: 1 } : null) } };
    expect(await freeName(prisma as unknown as PrismaService, "Ada")).toBe("Ada (3)");
    expect(await freeName(prisma as unknown as PrismaService, "grace")).toBe("grace");
  });
});
