import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { revokeOtherSessions } from "@/server/auth/service";

export const GET = api({}, async ({ user, sessionId }) => {
  const sessions = await prisma.session.findMany({
    where: { userId: user!.id, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true },
    orderBy: { lastSeenAt: "desc" },
  });
  return { sessions: sessions.map((s) => ({ ...s, current: s.id === sessionId })) };
});

export const DELETE = api({}, async ({ user, sessionId, ip }) => {
  const count = await revokeOtherSessions(user!.id, sessionId!, { ip });
  return { revoked: count };
});
