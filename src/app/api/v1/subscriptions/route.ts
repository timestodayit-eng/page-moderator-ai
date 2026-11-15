import { api, json } from "@/server/http";
import { prisma } from "@/server/db";
import { getEffectiveLimits, getUsage } from "@/server/billing/usage";
import { availableProviders } from "@/server/billing/providers";

export const GET = api({ permission: "billing.view" }, async ({ ws }) => {
  const sub = await prisma.subscription.findUnique({ where: { workspaceId: ws!.workspace.id }, include: { plan: true } });
  const [limits, usage, openInvoices] = await Promise.all([getEffectiveLimits(ws!.workspace.id), getUsage(ws!.workspace.id), prisma.invoice.count({ where: { workspaceId: ws!.workspace.id, status: "OPEN" } })]);
  const counts = { pages: await prisma.connectedPage.count({ where: { workspaceId: ws!.workspace.id, status: { not: "DISCONNECTED" } } }), users: await prisma.membership.count({ where: { workspaceId: ws!.workspace.id } }), agents: await prisma.agent.count({ where: { workspaceId: ws!.workspace.id, status: { not: "ARCHIVED" } } }) };
  return json({ subscription: sub, limits, usage, counts, openInvoices, billingExempt: ws!.workspace.billingExempt, providers: availableProviders() });
});
