import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { revokeSupportAccess } from "@/server/platform/admin";

export const GET = api({ auth: "platform-support" }, async () => ({
  grants: await prisma.supportAccessGrant.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { workspace: { select: { name: true, slug: true } } } }),
}));

export const DELETE = api({ auth: "platform-support", body: z.object({ grantId: z.string() }) }, async ({ user, body, ip }) => {
  await revokeSupportAccess(user!.id, body.grantId, { ip });
  return { ok: true };
});
