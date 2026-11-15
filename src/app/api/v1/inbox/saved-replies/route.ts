import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { Errors } from "@/server/errors";

export const GET = api({ permission: "inbox.manage" }, async ({ ws }) => ({ replies: await prisma.savedReply.findMany({ where: { workspaceId: ws!.workspace.id }, orderBy: { title: "asc" } }) }));
export const POST = api({ permission: "inbox.manage", body: z.object({ title: z.string().trim().min(1).max(80), body: z.string().min(1).max(2000), shortcut: z.string().max(20).optional() }) }, async ({ ws, body }) => ({ reply: await prisma.savedReply.create({ data: { workspaceId: ws!.workspace.id, ...body } }) }));
export const DELETE = api({ permission: "inbox.manage", body: z.object({ id: z.string() }) }, async ({ ws, body }) => {
  const r = await prisma.savedReply.findFirst({ where: { id: body.id, workspaceId: ws!.workspace.id } });
  if (!r) throw Errors.notFound("Saved reply");
  await prisma.savedReply.delete({ where: { id: r.id } });
  return { ok: true };
});
