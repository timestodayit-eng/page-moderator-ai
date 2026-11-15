import { api } from "@/server/http";
import { prisma } from "@/server/db";

export const GET = api({ permission: "crm.access" }, async ({ ws }) => ({
  tasks: await prisma.followUpTask.findMany({ where: { workspaceId: ws!.workspace.id, completedAt: null, ...(ws!.permissions.has("crm.all") ? {} : { assignedToId: ws!.user.id }) }, orderBy: { dueAt: "asc" }, take: 200, include: { lead: { select: { id: true, title: true, contact: { select: { name: true, phone: true } } } }, assignedTo: { select: { id: true, name: true } } } }),
}));
