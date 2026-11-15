import { api, json } from "@/server/http";
import { prisma } from "@/server/db";
import { currentPeriod } from "@/server/billing/usage";

export const GET = api({ auth: "platform-support" }, async () => {
  const since = new Date(`${currentPeriod()}-01T00:00:00Z`);
  const [agg, failures, platform, byok, byWs, byProvider, daily, setting] = await Promise.all([
    prisma.aiUsage.aggregate({ _sum: { costMicroUsd: true, tokensIn: true, tokensOut: true }, _count: true, where: { createdAt: { gte: since } } }),
    prisma.aiUsage.count({ where: { createdAt: { gte: since }, success: false } }),
    prisma.aiUsage.aggregate({ _sum: { costMicroUsd: true }, where: { createdAt: { gte: since }, credentialMode: "PLATFORM" } }),
    prisma.aiUsage.aggregate({ _sum: { costMicroUsd: true }, where: { createdAt: { gte: since }, credentialMode: "BYOK" } }),
    prisma.aiUsage.groupBy({ by: ["workspaceId", "credentialMode"], _count: true, _sum: { costMicroUsd: true }, where: { createdAt: { gte: since } }, orderBy: { _sum: { costMicroUsd: "desc" } }, take: 50 }),
    prisma.aiUsage.groupBy({ by: ["provider", "model"], _count: true, _sum: { costMicroUsd: true }, where: { createdAt: { gte: since } } }),
    prisma.$queryRaw<{ day: Date; requests: number; cost: bigint; failures: number }[]>`SELECT date_trunc('day',"createdAt") AS day, COUNT(*)::int AS requests, COALESCE(SUM("costMicroUsd"),0) AS cost, COUNT(*) FILTER (WHERE NOT success)::int AS failures FROM "AiUsage" WHERE "createdAt" >= (NOW() AT TIME ZONE 'UTC') - interval '30 days' GROUP BY 1 ORDER BY 1`,
    prisma.platformSetting.findUnique({ where: { key: "ai" } }),
  ]);
  const failuresByProvider = await prisma.aiUsage.groupBy({ by: ["provider", "model"], _count: true, where: { createdAt: { gte: since }, success: false } });
  const names = await prisma.workspace.findMany({ where: { id: { in: byWs.map((w) => w.workspaceId) } }, select: { id: true, name: true } });
  return json({
    month: { costMicroUsd: Number(agg._sum.costMicroUsd ?? 0n), requests: agg._count, tokens: (agg._sum.tokensIn ?? 0) + (agg._sum.tokensOut ?? 0), failures, platformCost: Number(platform._sum.costMicroUsd ?? 0n), byokCost: Number(byok._sum.costMicroUsd ?? 0n) },
    budget: { capMicroUsd: (setting?.value as { monthlyPlatformBudgetMicroUsd?: number })?.monthlyPlatformBudgetMicroUsd ?? null },
    byWorkspace: byWs.map((w) => ({ workspaceId: w.workspaceId, name: names.find((n) => n.id === w.workspaceId)?.name ?? w.workspaceId, mode: w.credentialMode, requests: w._count, costMicroUsd: Number(w._sum.costMicroUsd ?? 0n) })),
    byProvider: byProvider.map((p) => ({ provider: p.provider, model: p.model, requests: p._count, costMicroUsd: Number(p._sum.costMicroUsd ?? 0n), failures: failuresByProvider.find((f) => f.provider === p.provider && f.model === p.model)?._count ?? 0 })),
    daily: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), requests: d.requests, costMicroUsd: Number(d.cost), failures: d.failures })),
  });
});
