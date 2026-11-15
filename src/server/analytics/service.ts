import { prisma } from "../db";
import { moderationStats } from "../moderation/review";

export async function workspaceAnalytics(workspaceId: string, days: number) {
  const since = new Date(Date.now() - days * 86_400_000);
  const [moderation, convVolume, firstResponse, resolution, byAgentConv, aiAssisted, leadsNew, leadsQualified, leadsConverted, leadsBySource, leadsByAssignee, followUps, pages, aiCost, daily] = await Promise.all([
    moderationStats(workspaceId, undefined, days),
    prisma.conversation.count({ where: { workspaceId, createdAt: { gte: since } } }),
    prisma.$queryRaw<{ avg_seconds: number | null }[]>`SELECT AVG(EXTRACT(EPOCH FROM (o."createdAt" - i."createdAt")))::float AS avg_seconds FROM "Conversation" c
      JOIN LATERAL (SELECT MIN("createdAt") "createdAt" FROM "Message" WHERE "conversationId"=c.id AND direction='IN') i ON TRUE
      JOIN LATERAL (SELECT MIN("createdAt") "createdAt" FROM "Message" WHERE "conversationId"=c.id AND direction='OUT' AND "createdAt" > i."createdAt") o ON TRUE
      WHERE c."workspaceId"=${workspaceId} AND c."createdAt" >= ${since}`,
    prisma.$queryRaw<{ avg_seconds: number | null }[]>`SELECT AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt")))::float AS avg_seconds FROM "Conversation" WHERE "workspaceId"=${workspaceId} AND status IN ('RESOLVED','CLOSED') AND "updatedAt" >= ${since}`,
    prisma.conversation.groupBy({ by: ["assignedToId"], _count: true, where: { workspaceId, updatedAt: { gte: since }, assignedToId: { not: null } } }),
    prisma.message.count({ where: { workspaceId, direction: "OUT", senderType: "AI", createdAt: { gte: since } } }),
    prisma.lead.count({ where: { workspaceId, createdAt: { gte: since } } }),
    prisma.lead.count({ where: { workspaceId, status: { in: ["QUALIFIED", "FOLLOW_UP", "CONVERTED"] }, updatedAt: { gte: since } } }),
    prisma.lead.count({ where: { workspaceId, status: "CONVERTED", convertedAt: { gte: since } } }),
    prisma.lead.groupBy({ by: ["source"], _count: true, where: { workspaceId, createdAt: { gte: since } } }),
    prisma.lead.groupBy({ by: ["assignedToId"], _count: true, where: { workspaceId, assignedToId: { not: null } } }),
    prisma.leadActivity.count({ where: { workspaceId, type: { in: ["NOTE", "CALL", "MESSAGE"] }, createdAt: { gte: since } } }),
    prisma.connectedPage.count({ where: { workspaceId, status: { not: "DISCONNECTED" } } }),
    prisma.aiUsage.aggregate({ _sum: { costMicroUsd: true }, _count: true, where: { workspaceId, createdAt: { gte: since } } }),
    prisma.$queryRaw<{ day: Date; comments: number; conversations: number; leads: number; ai_requests: number }[]>`
      WITH d AS (SELECT generate_series(date_trunc('day', ${since}::timestamp), date_trunc('day', (NOW() AT TIME ZONE 'UTC')), '1 day') AS day)
      SELECT d.day,
        (SELECT COUNT(*)::int FROM "Comment" WHERE "workspaceId"=${workspaceId} AND date_trunc('day',"receivedAt")=d.day) comments,
        (SELECT COUNT(*)::int FROM "Conversation" WHERE "workspaceId"=${workspaceId} AND date_trunc('day',"createdAt")=d.day) conversations,
        (SELECT COUNT(*)::int FROM "Lead" WHERE "workspaceId"=${workspaceId} AND date_trunc('day',"createdAt")=d.day) leads,
        (SELECT COUNT(*)::int FROM "AiUsage" WHERE "workspaceId"=${workspaceId} AND date_trunc('day',"createdAt")=d.day) ai_requests
      FROM d ORDER BY d.day`,
  ]);
  const userIds = [...new Set([...byAgentConv.map((a) => a.assignedToId), ...leadsByAssignee.map((a) => a.assignedToId)].filter(Boolean))] as string[];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? "Unassigned";
  return {
    days,
    moderation,
    support: { conversations: convVolume, firstResponseSeconds: firstResponse[0]?.avg_seconds ?? null, resolutionSeconds: resolution[0]?.avg_seconds ?? null, aiAssistedReplies: aiAssisted, byEmployee: byAgentConv.map((a) => ({ name: name(a.assignedToId), conversations: a._count })) },
    crm: { newLeads: leadsNew, qualified: leadsQualified, converted: leadsConverted, conversionRate: leadsNew ? leadsConverted / leadsNew : 0, bySource: Object.fromEntries(leadsBySource.map((s) => [s.source, s._count])), byEmployee: leadsByAssignee.map((a) => ({ name: name(a.assignedToId), leads: a._count })), followUpActivities: followUps },
    business: { pages, aiRequests: aiCost._count, aiCostMicroUsd: Number(aiCost._sum.costMicroUsd ?? 0n) },
    daily: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), comments: d.comments, conversations: d.conversations, leads: d.leads, aiRequests: d.ai_requests })),
  };
}
