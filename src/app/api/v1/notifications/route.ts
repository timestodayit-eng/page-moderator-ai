import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";

export const GET = api({}, async ({ user }) => ({ notifications: await prisma.notification.findMany({ where: { userId: user!.id }, orderBy: { createdAt: "desc" }, take: 50 }), unread: await prisma.notification.count({ where: { userId: user!.id, readAt: null } }) }));
export const POST = api({ body: z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() }) }, async ({ user, body }) => {
  await prisma.notification.updateMany({ where: { userId: user!.id, readAt: null, ...(body.all ? {} : { id: { in: body.ids ?? [] } }) }, data: { readAt: new Date() } });
  return { ok: true };
});
