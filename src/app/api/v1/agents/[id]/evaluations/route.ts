import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { Errors } from "@/server/errors";
import { enqueueOutbox } from "@/server/queue/outbox";

export const GET = api({ permission: "dashboard.view" }, async ({ ws, params }) => ({ evaluations: await prisma.agentEvaluation.findMany({ where: { agentId: params.id, workspaceId: ws!.workspace.id }, orderBy: { createdAt: "desc" }, take: 20 }) }));

export const POST = api({ permission: "agents.train", body: z.object({ versionId: z.string().optional() }) }, async ({ ws, params, body }) => {
  const agent = await prisma.agent.findFirst({ where: { id: params.id, workspaceId: ws!.workspace.id } });
  if (!agent) throw Errors.notFound("Agent");
  const versionId = body.versionId ?? agent.activeVersionId;
  if (!versionId) throw Errors.badRequest("Agent has no version");
  const examples = await prisma.trainingExample.count({ where: { workspaceId: ws!.workspace.id, kind: "MODERATION", status: "ACTIVE", category: { not: null } } });
  if (examples < 5) throw Errors.badRequest("Add at least 5 labelled moderation examples before running an evaluation");
  const ev = await prisma.$transaction(async (tx) => {
    const e = await tx.agentEvaluation.create({ data: { workspaceId: ws!.workspace.id, agentId: agent.id, agentVersionId: versionId, createdById: ws!.user.id } });
    await enqueueOutbox("ai.evaluate", { evaluationId: e.id }, tx);
    return e;
  });
  return { evaluation: ev };
});
