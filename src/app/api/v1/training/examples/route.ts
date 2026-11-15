import { z } from "zod";
import { api, paginate } from "@/server/http";
import { prisma } from "@/server/db";
import { CATEGORIES } from "@/server/moderation/classifier";

export const GET = api({ permission: "dashboard.view" }, async ({ req, ws }) => {
  const { skip, take, page, pageSize } = paginate(req);
  const sp = req.nextUrl.searchParams;
  const where = { workspaceId: ws!.workspace.id, ...(sp.get("kind") ? { kind: sp.get("kind")! } : {}), ...(sp.get("category") ? { category: sp.get("category")! } : {}), ...(sp.get("source") ? { source: sp.get("source")! } : {}), ...(sp.get("search") ? { text: { contains: sp.get("search")!, mode: "insensitive" as const } } : {}) };
  const [total, rows] = await Promise.all([prisma.trainingExample.count({ where }), prisma.trainingExample.findMany({ where, skip, take, orderBy: { updatedAt: "desc" } })]);
  return { total, rows, page, pageSize, categories: CATEGORIES };
});

const example = z.object({ kind: z.enum(["MODERATION", "REPLY"]).default("MODERATION"), text: z.string().min(1).max(4000), language: z.enum(["bn", "banglish", "en", "mixed"]).default("bn"), category: z.enum(CATEGORIES).optional(), expectedDecision: z.enum(["HIDE", "REVIEW", "KEEP", "REPLY"]).optional(), expectedReply: z.string().max(2000).optional(), explanation: z.string().max(1000).optional(), confidenceTarget: z.number().min(0).max(1).optional(), agentId: z.string().nullable().optional() });

export const POST = api({ permission: "agents.train", body: z.object({ examples: z.array(example).min(1).max(500) }) }, async ({ ws, body }) => {
  const created = await prisma.trainingExample.createMany({ data: body.examples.map((e) => ({ workspaceId: ws!.workspace.id, kind: e.kind, text: e.text.trim(), language: e.language, category: e.category ?? null, expectedDecision: e.expectedDecision ?? null, expectedReply: e.expectedReply ?? null, explanation: e.explanation ?? "", confidenceTarget: e.confidenceTarget ?? null, agentId: e.agentId ?? null, source: body.examples.length > 1 ? "IMPORT" : "MANUAL", createdById: ws!.user.id })) });
  return { created: created.count };
});
