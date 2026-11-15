import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { createAgent } from "@/server/agents/service";
import { PROVIDER_MODELS } from "@/server/ai/gateway";

export const GET = api({ permission: "dashboard.view" }, async ({ ws }) => {
  const agents = await prisma.agent.findMany({ where: { workspaceId: ws!.workspace.id }, orderBy: { updatedAt: "desc" }, include: { versions: { orderBy: { version: "desc" }, take: 1 }, _count: { select: { versions: true, evaluations: true } } } });
  return { agents, providers: PROVIDER_MODELS };
});

export const versionSchema = z.object({
  instructions: z.string().min(10).max(8000),
  languages: z.array(z.enum(["bn", "banglish", "en"])).min(1),
  tone: z.string().min(2).max(80),
  provider: z.enum(["openai", "gemini", "deepseek"]),
  model: z.string().min(2),
  temperature: z.number().min(0).max(1.5),
  safetyRules: z.string().max(4000).optional(),
  allowedActions: z.array(z.string()).max(20).optional(),
  escalationRules: z.string().max(4000).optional(),
  responseConstraints: z.string().max(2000).optional(),
  knowledgeSourceIds: z.array(z.string()).max(50).optional(),
  changeNote: z.string().max(300).optional(),
});

export const POST = api({ permission: "agents.configure", body: z.object({ name: z.string().trim().min(2).max(80), description: z.string().max(300).optional(), purpose: z.enum(["MODERATION", "PUBLIC_REPLY", "SUPPORT", "SALES", "LEAD_QUALIFICATION", "COMPLAINT", "MESSENGER"]), pageId: z.string().nullable().optional(), version: versionSchema, activate: z.boolean().optional() }) }, async ({ ws, body, ip }) => ({ agent: await createAgent(ws!, body, { ip }) }));
