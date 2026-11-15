import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { Errors } from "@/server/errors";
import { setAgentStatus } from "@/server/agents/service";

export const GET = api({ permission: "dashboard.view" }, async ({ ws, params }) => {
  const agent = await prisma.agent.findFirst({ where: { id: params.id, workspaceId: ws!.workspace.id }, include: { versions: { orderBy: { version: "desc" } }, evaluations: { orderBy: { createdAt: "desc" }, take: 10 } } });
  if (!agent) throw Errors.notFound("Agent");
  const pages = await prisma.connectedPage.findMany({ where: { workspaceId: ws!.workspace.id, OR: [{ moderationAgentId: agent.id }, { replyAgentId: agent.id }, { messengerAgentId: agent.id }] }, select: { id: true, name: true } });
  return { agent, assignedPages: pages };
});

export const PATCH = api({ permission: "agents.configure", body: z.object({ status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(), activeVersionId: z.string().optional(), name: z.string().trim().min(2).max(80).optional(), description: z.string().max(300).optional(), pageId: z.string().nullable().optional() }) }, async ({ ws, params, body, ip }) => {
  await setAgentStatus(ws!, params.id, body, { ip });
  return { ok: true };
});
