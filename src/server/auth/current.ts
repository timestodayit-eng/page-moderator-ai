import { cookies, headers } from "next/headers";
import { SESSION_COOKIE, validateSessionToken } from "./session";
import { resolveWorkspaceContext, type WorkspaceContext } from "../rbac/guard";
import { prisma } from "../db";

/** Server-component helpers (RSC). */
export async function currentSession() {
  const jar = await cookies();
  return validateSessionToken(jar.get(SESSION_COOKIE)?.value);
}

export async function currentUser() {
  const s = await currentSession();
  return s?.user ?? null;
}

export async function workspaceContextFor(slug: string): Promise<WorkspaceContext | null> {
  const s = await currentSession();
  if (!s) return null;
  try {
    return await resolveWorkspaceContext(s.user, slug);
  } catch {
    return null;
  }
}

export async function requestMeta() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"), userAgent: h.get("user-agent") };
}

export async function unreadNotifications(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
