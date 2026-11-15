import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { createCampaign, resolveRecipients } from "@/server/platform/admin";

export const GET = api({ auth: "platform" }, async () => ({ campaigns: await prisma.emailCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 50 }) }));

const filter = z.object({ workspaceIds: z.array(z.string()).optional(), roles: z.array(z.string()).optional(), allOwners: z.boolean().optional() });
export const POST = api({ auth: "platform", body: z.object({ name: z.string().trim().min(2).max(120), templateKey: z.string(), recipientFilter: filter, vars: z.record(z.string(), z.string().max(5000)).default({}), scheduledAt: z.iso.datetime().optional(), sendNow: z.boolean().default(false), previewOnly: z.boolean().default(false) }) }, async ({ user, body, ip }) => {
  if (body.previewOnly) {
    const r = await resolveRecipients(body.recipientFilter);
    return { recipients: r.length, sample: r.slice(0, 10).map((m) => ({ email: m.user.email, workspace: m.workspace.name })) };
  }
  return createCampaign(user!.id, { ...body, scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null }, { ip });
});
