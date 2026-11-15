import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { indexSource } from "@/server/agents/knowledge";
import { audit } from "@/server/audit";

export const GET = api({ permission: "dashboard.view" }, async ({ ws }) => ({ sources: await prisma.knowledgeSource.findMany({ where: { workspaceId: ws!.workspace.id }, orderBy: { updatedAt: "desc" }, include: { _count: { select: { chunks: true } } } }) }));

const KINDS = ["company", "services", "policy", "faq", "approved_reply", "product", "pricing", "terms", "text"] as const;
/** Text-based knowledge (typed or pasted). Files go through /training/upload. */
export const POST = api({ permission: "agents.train", body: z.object({ title: z.string().trim().min(2).max(120), kind: z.enum(KINDS), content: z.string().min(5).max(200_000), agentId: z.string().nullable().optional() }) }, async ({ ws, body, ip }) => {
  const source = await prisma.$transaction(async (tx) => {
    const s = await tx.knowledgeSource.create({ data: { workspaceId: ws!.workspace.id, title: body.title, kind: body.kind, agentId: body.agentId ?? null, createdById: ws!.user.id, mimeType: "text/plain" } });
    await indexSource(s.id, body.content, tx);
    await audit({ workspaceId: ws!.workspace.id, actorUserId: ws!.user.id, action: "knowledge.created", targetType: "KnowledgeSource", targetId: s.id, ip, meta: { kind: body.kind, title: body.title } }, tx);
    return s;
  });
  return { source };
});
