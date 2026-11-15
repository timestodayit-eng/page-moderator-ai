import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { Errors } from "@/server/errors";
import { indexSource } from "@/server/agents/knowledge";
import { audit } from "@/server/audit";
import { storage } from "@/server/storage/driver";

export const GET = api({ permission: "dashboard.view" }, async ({ ws, params }) => {
  const s = await prisma.knowledgeSource.findFirst({ where: { id: params.id, workspaceId: ws!.workspace.id }, include: { chunks: { orderBy: { ordinal: "asc" } } } });
  if (!s) throw Errors.notFound("Knowledge source");
  return { source: s };
});

export const PATCH = api({ permission: "agents.train", body: z.object({ title: z.string().trim().min(2).max(120).optional(), content: z.string().min(5).max(200_000).optional() }) }, async ({ ws, params, body, ip }) => {
  const s = await prisma.knowledgeSource.findFirst({ where: { id: params.id, workspaceId: ws!.workspace.id } });
  if (!s) throw Errors.notFound("Knowledge source");
  await prisma.$transaction(async (tx) => {
    await tx.knowledgeSource.update({ where: { id: s.id }, data: { title: body.title } });
    if (body.content) await indexSource(s.id, body.content, tx);
    await audit({ workspaceId: ws!.workspace.id, actorUserId: ws!.user.id, action: "knowledge.updated", targetType: "KnowledgeSource", targetId: s.id, ip }, tx);
  });
  return { ok: true };
});

export const DELETE = api({ permission: "agents.train" }, async ({ ws, params, ip }) => {
  const s = await prisma.knowledgeSource.findFirst({ where: { id: params.id, workspaceId: ws!.workspace.id } });
  if (!s) throw Errors.notFound("Knowledge source");
  if (s.storageKey) await storage().delete(s.storageKey);
  await prisma.knowledgeSource.delete({ where: { id: s.id } });
  await audit({ workspaceId: ws!.workspace.id, actorUserId: ws!.user.id, action: "knowledge.deleted", targetType: "KnowledgeSource", targetId: s.id, ip, meta: { title: s.title } });
  return { ok: true };
});
