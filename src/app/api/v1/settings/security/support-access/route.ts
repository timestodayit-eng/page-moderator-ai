import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { decideSupportAccess } from "@/server/platform/admin";

export const GET = api({ permission: "settings.manage" }, async ({ ws }) => ({ grants: await prisma.supportAccessGrant.findMany({ where: { workspaceId: ws!.workspace.id }, orderBy: { createdAt: "desc" }, take: 50 }) }));
export const POST = api({ permission: "settings.manage", body: z.object({ grantId: z.string(), approve: z.boolean(), hours: z.number().int().min(1).max(72).default(24) }) }, async ({ ws, body, ip }) => {
  await decideSupportAccess(ws!.user.id, ws!.workspace.id, body.grantId, body.approve, body.hours, { ip });
  return { ok: true };
});
