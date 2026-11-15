import { prisma, type Tx } from "../db";
import { Errors } from "../errors";
import { mergeLimits, type PlanLimits } from "./plans";

export type UsageMetric = "COMMENTS_PROCESSED" | "AI_REQUEST" | "AI_TOKENS" | "AI_COST_MICROUSD" | "AUTO_REPLY" | "AUTO_HIDE" | "STORAGE_BYTES";

export function currentPeriod(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getEffectiveLimits(workspaceId: string, tx: Tx = prisma): Promise<PlanLimits & { subscriptionStatus: string; serviceActive: boolean }> {
  const sub = await tx.subscription.findUnique({ where: { workspaceId }, include: { plan: true } });
  const ws = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { status: true, billingExempt: true } });
  const limits = mergeLimits(sub?.plan.limits, sub?.limitOverrides);
  const status = sub?.status ?? "EXPIRED";
  const serviceActive = Boolean(ws && ws.status === "ACTIVE" && (ws.billingExempt || ["TRIALING", "ACTIVE", "GRACE", "EXEMPT"].includes(status)));
  return { ...limits, subscriptionStatus: status, serviceActive };
}

/** Throws PLAN_LIMIT when a static resource count (pages, users, agents) would exceed the plan. */
export async function enforceLimit(workspaceId: string, key: "pages" | "users" | "agents", wouldBe: number) {
  const limits = await getEffectiveLimits(workspaceId);
  if (wouldBe > limits[key]) throw Errors.limitReached(`Your plan allows ${limits[key]} ${key}. Upgrade to add more.`);
}

/** Append-only usage event + atomic counter increment. */
export async function recordUsage(workspaceId: string, metric: UsageMetric, quantity: number | bigint, ref?: { type: string; id: string }, tx: Tx = prisma) {
  const period = currentPeriod();
  const q = BigInt(quantity);
  await tx.usageEvent.create({ data: { workspaceId, metric, quantity: q, period, refType: ref?.type, refId: ref?.id } });
  await tx.$executeRaw`INSERT INTO "UsageCounter" ("workspaceId","period","metric","value","reserved") VALUES (${workspaceId}, ${period}, ${metric}, ${q}, 0)
    ON CONFLICT ("workspaceId","period","metric") DO UPDATE SET "value" = "UsageCounter"."value" + ${q}`;
}

export async function getUsage(workspaceId: string, period = currentPeriod()) {
  const rows = await prisma.usageCounter.findMany({ where: { workspaceId, period } });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.metric] = Number(r.value);
  return out;
}

/**
 * Atomically reserve AI budget / request quota for a workspace. A single conditional UPDATE means that
 * N concurrent workers cannot collectively overspend (the prototype checked-then-incremented).
 * Returns false when the quota would be exceeded; caller must then skip the AI call.
 */
export async function reserveAiQuota(workspaceId: string, estimatedCostMicroUsd: number, credentialMode: "PLATFORM" | "BYOK") {
  const limits = await getEffectiveLimits(workspaceId);
  if (!limits.serviceActive) return { ok: false as const, reason: "SUBSCRIPTION_INACTIVE" as const };
  const period = currentPeriod();
  // Requests count for everyone; platform-paid cost only when using platform credentials.
  const requestLimit = BigInt(limits.aiRequestsPerMonth);
  await prisma.$executeRaw`INSERT INTO "UsageCounter" ("workspaceId","period","metric","value","reserved") VALUES (${workspaceId}, ${period}, 'AI_REQUEST', 0, 0) ON CONFLICT DO NOTHING`;
  const reqRows = await prisma.$executeRaw`UPDATE "UsageCounter" SET "reserved" = "reserved" + 1 WHERE "workspaceId" = ${workspaceId} AND "period" = ${period} AND "metric" = 'AI_REQUEST' AND "value" + "reserved" < ${requestLimit}`;
  if (reqRows === 0) return { ok: false as const, reason: "AI_REQUEST_LIMIT" as const };

  if (credentialMode === "PLATFORM") {
    const budget = BigInt(limits.aiBudgetMicroUsd);
    const est = BigInt(Math.max(1, Math.round(estimatedCostMicroUsd)));
    await prisma.$executeRaw`INSERT INTO "UsageCounter" ("workspaceId","period","metric","value","reserved") VALUES (${workspaceId}, ${period}, 'AI_COST_MICROUSD', 0, 0) ON CONFLICT DO NOTHING`;
    const costRows = await prisma.$executeRaw`UPDATE "UsageCounter" SET "reserved" = "reserved" + ${est} WHERE "workspaceId" = ${workspaceId} AND "period" = ${period} AND "metric" = 'AI_COST_MICROUSD' AND "value" + "reserved" + ${est} <= ${budget}`;
    if (costRows === 0) {
      await prisma.$executeRaw`UPDATE "UsageCounter" SET "reserved" = GREATEST("reserved" - 1, 0) WHERE "workspaceId" = ${workspaceId} AND "period" = ${period} AND "metric" = 'AI_REQUEST'`;
      return { ok: false as const, reason: "AI_BUDGET_LIMIT" as const };
    }
    return { ok: true as const, release: () => settleReservation(workspaceId, period, est, 0n, 0n, true), settle: (actualCost: number) => settleReservation(workspaceId, period, est, BigInt(Math.round(actualCost)), 1n, false) };
  }
  return { ok: true as const, release: () => settleReservation(workspaceId, period, 0n, 0n, 0n, true), settle: (actualCost: number) => settleReservation(workspaceId, period, 0n, BigInt(Math.round(actualCost)), 1n, false) };
}

async function settleReservation(workspaceId: string, period: string, reservedCost: bigint, actualCost: bigint, requests: bigint, release: boolean) {
  await prisma.$executeRaw`UPDATE "UsageCounter" SET "reserved" = GREATEST("reserved" - 1, 0), "value" = "value" + ${release ? 0n : requests} WHERE "workspaceId" = ${workspaceId} AND "period" = ${period} AND "metric" = 'AI_REQUEST'`;
  if (reservedCost > 0n || actualCost > 0n) {
    await prisma.$executeRaw`UPDATE "UsageCounter" SET "reserved" = GREATEST("reserved" - ${reservedCost}, 0), "value" = "value" + ${release ? 0n : actualCost} WHERE "workspaceId" = ${workspaceId} AND "period" = ${period} AND "metric" = 'AI_COST_MICROUSD'`;
  }
}

/** Platform-wide monthly AI spend guard (Super Admin budget). */
export async function platformAiSpendThisMonth() {
  const period = currentPeriod();
  const row = await prisma.aiUsage.aggregate({ _sum: { costMicroUsd: true }, where: { credentialMode: "PLATFORM", createdAt: { gte: new Date(`${period}-01T00:00:00Z`) } } });
  return Number(row._sum.costMicroUsd ?? 0n);
}
