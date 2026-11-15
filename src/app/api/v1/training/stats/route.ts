import { api, json } from "@/server/http";
import { prisma } from "@/server/db";

export const GET = api({ permission: "dashboard.view" }, async ({ ws }) => {
  const wid = ws!.workspace.id;
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [documents, examples, evaluated, reviewed, agreed, falsePositives, aiHides, replies, approvedReplies, versions, recentEvals] = await Promise.all([
    prisma.knowledgeSource.count({ where: { workspaceId: wid, status: "READY" } }),
    prisma.trainingExample.count({ where: { workspaceId: wid, status: "ACTIVE" } }),
    prisma.trainingExample.count({ where: { workspaceId: wid, status: "ACTIVE", reviewerFeedback: { not: "" } } }),
    prisma.moderationDecision.count({ where: { workspaceId: wid, reviewStatus: { in: ["APPROVED", "REJECTED"] }, createdAt: { gte: since } } }),
    prisma.moderationDecision.count({ where: { workspaceId: wid, reviewStatus: "APPROVED", createdAt: { gte: since } } }),
    prisma.moderationDecision.count({ where: { workspaceId: wid, feedback: "FALSE_POSITIVE", createdAt: { gte: since } } }),
    prisma.moderationDecision.count({ where: { workspaceId: wid, decision: "HIDE", createdAt: { gte: since } } }),
    prisma.moderationDecision.count({ where: { workspaceId: wid, decision: "REPLY", reviewStatus: { in: ["APPROVED", "REJECTED"] }, createdAt: { gte: since } } }),
    prisma.moderationDecision.count({ where: { workspaceId: wid, decision: "REPLY", reviewStatus: "APPROVED", createdAt: { gte: since } } }),
    prisma.agentVersion.count({ where: { workspaceId: wid } }),
    prisma.agentEvaluation.findMany({ where: { workspaceId: wid, status: "COMPLETED" }, orderBy: { completedAt: "desc" }, take: 10, include: { agent: { select: { name: true } } } }),
  ]);
  const latest = recentEvals[0]?.metrics as { accuracy?: number; perCategory?: Record<string, { precision: number; recall: number }> } | undefined;
  return json({ documents, examples, evaluated, reviewerAgreement: reviewed ? agreed / reviewed : null, falsePositiveRate: aiHides ? falsePositives / aiHides : null, replyApprovalRate: replies ? approvedReplies / replies : null, versions, latestAccuracy: latest?.accuracy ?? null, perCategory: latest?.perCategory ?? null, recentEvaluations: recentEvals.map((e) => ({ id: e.id, agent: e.agent.name, completedAt: e.completedAt, total: e.total, correct: e.correct, metrics: e.metrics })) });
});
