import { api, paginate } from "@/server/http";
import { prisma } from "@/server/db";

export const GET = api({ permission: "billing.view" }, async ({ req, ws }) => {
  const { skip, take, page, pageSize } = paginate(req);
  const where = { workspaceId: ws!.workspace.id };
  const [total, rows] = await Promise.all([prisma.invoice.count({ where }), prisma.invoice.findMany({ where, skip, take, orderBy: { createdAt: "desc" }, include: { payments: true } })]);
  return { total, rows, page, pageSize };
});
