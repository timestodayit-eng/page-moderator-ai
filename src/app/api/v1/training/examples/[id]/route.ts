import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { Errors } from "@/server/errors";
import { CATEGORIES } from "@/server/moderation/classifier";

export const PATCH = api({ permission: "agents.train", body: z.object({ category: z.enum(CATEGORIES).optional(), expectedDecision: z.enum(["HIDE", "REVIEW", "KEEP", "REPLY"]).optional(), expectedReply: z.string().max(2000).optional(), explanation: z.string().max(1000).optional(), reviewerFeedback: z.string().max(1000).optional(), status: z.enum(["ACTIVE", "ARCHIVED"]).optional() }) }, async ({ ws, params, body }) => {
  const ex = await prisma.trainingExample.findFirst({ where: { id: params.id, workspaceId: ws!.workspace.id } });
  if (!ex) throw Errors.notFound("Example");
  await prisma.trainingExample.update({ where: { id: ex.id }, data: body });
  return { ok: true };
});

export const DELETE = api({ permission: "agents.train" }, async ({ ws, params }) => {
  const ex = await prisma.trainingExample.findFirst({ where: { id: params.id, workspaceId: ws!.workspace.id } });
  if (!ex) throw Errors.notFound("Example");
  await prisma.trainingExample.delete({ where: { id: ex.id } });
  return { ok: true };
});
