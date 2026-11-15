import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { Errors } from "@/server/errors";

export const GET = api({ permission: "billing.view" }, async ({ ws, params }) => {
  const inv = await prisma.invoice.findFirst({ where: { id: params.id, workspaceId: ws!.workspace.id }, include: { payments: true, workspace: { select: { name: true, businessProfile: true } } } });
  if (!inv) throw Errors.notFound("Invoice");
  return { invoice: inv };
});
