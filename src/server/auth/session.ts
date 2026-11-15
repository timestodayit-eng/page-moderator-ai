import { prisma } from "../db";
import { env } from "../env";
import { generateToken, sha256 } from "../crypto";

export const SESSION_COOKIE = "pm_session";

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + env().SESSION_TTL_HOURS * 3600_000);
  const session = await prisma.session.create({
    data: { userId, tokenHash: sha256(token), ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null, expiresAt },
  });
  return { token, session };
}

export async function validateSessionToken(token: string | undefined | null) {
  if (!token || token.length < 20 || token.length > 200) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  if (session.user.status !== "ACTIVE") return null;
  // Sessions issued before a password change are invalid.
  if (session.user.passwordChangedAt && session.createdAt < session.user.passwordChangedAt) return null;
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return session;
}

export async function revokeSession(sessionId: string, reason = "logout") {
  await prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
}

export async function revokeAllSessions(userId: string, reason: string, exceptSessionId?: string) {
  const res = await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
  return res.count;
}
