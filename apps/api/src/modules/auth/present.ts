import type { User } from "@prisma/client";

/** The user as the interface knows it. */
export function presentUser(user: Pick<User, "id" | "name" | "role" | "avatarUrl" | "email">) {
  return { id: user.id, name: user.name, role: user.role, avatarUrl: user.avatarUrl, email: user.email };
}

/**
 * Keeps a "next" target on the dashboard: a path, never another site.
 */
export function safeNext(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : null;
}
