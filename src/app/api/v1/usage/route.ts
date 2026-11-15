import { api, json } from "@/server/http";
import { prisma } from "@/server/db";
import { currentPeriod, getEffectiveLimits, getUsage } from "@/server/billing/usage";

export const GET = api({ permission: "billing.view" }, async ({ req, ws }) => {
  const period = req.nextUrl.searchParams.get("period") ?? currentPeriod();
  const [limits, usage, byProvider, byAgent, daily] = await Promise.all([
    getEffectiveLimits(ws!.workspace.id),
    getUsage(ws!.workspace.id, period),
    prisma.aiUsage.groupBy({ by: ["provider", "model", "credentialMode"], _count: true, _sum: { tokensIn: true, tokensOut: true, costMicroUsd: true }, where: { workspaceId: ws!.workspace.id, createdAt: { gte: new Date(`${period}-01T00:00:00Z`) } } }),
    prisma.aiUsage.groupBy({ by: ["agentId", "purpose"], _count: true, _sum: { costMicroUsd: true }, where: { workspaceId: ws!.workspace.id, createdAt: { gte: new Date(`${period}-01T00:00:00Z`) } } }),
    prisma.$queryRaw<{ day: Date; requests: number; cost: bigint }[]>`SELECT date_trunc('day',"createdAt") day, COUNT(*)::int requests, COALESCE(SUM("costMicroUsd"),0) cost FROM "AiUsage" WHERE "workspaceId"=${ws!.workspace.id} AND "createdAt" >= (NOW() AT TIME ZONE 'UTC') - interval '30 days' GROUP BY 1 ORDER BY 1`,
  ]);
  return json({ period, limits, usage, byProvider, byAgent, daily: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), requests: d.requests, costMicroUsd: Number(d.cost) })) });
});
