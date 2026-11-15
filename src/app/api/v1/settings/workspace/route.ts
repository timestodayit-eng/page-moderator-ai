import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { appLink, queueEmail } from "@/server/email/service";

export const GET = api({ permission: "dashboard.view" }, async ({ ws }) => {
  const w = ws!.workspace;
  return { workspace: { id: w.id, slug: w.slug, name: w.name, type: w.type, status: w.status, timezone: w.timezone, defaultLocale: w.defaultLocale, businessProfile: w.businessProfile, emergencyPause: w.emergencyPause, servicesEnabled: w.servicesEnabled, aiCredentialMode: w.aiCredentialMode }, role: ws!.membership?.role.key ?? null, permissions: [...ws!.permissions] };
});

const profile = z.object({ displayName: z.string().max(120).optional(), description: z.string().max(1000).optional(), phone: z.string().max(40).optional(), email: z.email().optional().or(z.literal("")), website: z.url().optional().or(z.literal("")), address: z.string().max(300).optional(), industry: z.string().max(80).optional(), officialContactLine: z.string().max(300).optional() });

export const PATCH = api({ permission: "settings.manage", body: z.object({ name: z.string().trim().min(2).max(120).optional(), timezone: z.string().max(60).optional(), defaultLocale: z.enum(["en", "bn"]).optional(), businessProfile: profile.optional(), emergencyPause: z.boolean().optional() }) }, async ({ ws, body, ip }) => {
  const before = { name: ws!.workspace.name, emergencyPause: ws!.workspace.emergencyPause, timezone: ws!.workspace.timezone, defaultLocale: ws!.workspace.defaultLocale };
  await prisma.$transaction(async (tx) => {
    await tx.workspace.update({ where: { id: ws!.workspace.id }, data: { name: body.name, timezone: body.timezone, defaultLocale: body.defaultLocale, emergencyPause: body.emergencyPause, businessProfile: body.businessProfile ? { ...(ws!.workspace.businessProfile as object), ...body.businessProfile } : undefined } });
    if (body.emergencyPause) await tx.outboundAction.updateMany({ where: { workspaceId: ws!.workspace.id, status: "PENDING", createdById: null }, data: { status: "CANCELLED", lastError: "emergency pause" } });
    await audit({ workspaceId: ws!.workspace.id, actorUserId: ws!.user.id, action: body.emergencyPause !== undefined && body.emergencyPause !== before.emergencyPause ? (body.emergencyPause ? "workspace.emergency_pause_on" : "workspace.emergency_pause_off") : "workspace.settings_updated", targetType: "Workspace", targetId: ws!.workspace.id, ip, meta: { before, patch: body } }, tx);
    if (body.emergencyPause !== undefined && body.emergencyPause !== before.emergencyPause) {
      const owners = await tx.membership.findMany({ where: { workspaceId: ws!.workspace.id, role: { key: "owner" } }, include: { user: true } });
      for (const m of owners) if (m.userId !== ws!.user.id) await queueEmail({ to: m.user.email, templateKey: "ops.config_changed", workspaceId: ws!.workspace.id, userId: m.userId, locale: m.user.locale, vars: { name: m.user.name, workspaceName: ws!.workspace.name, actor: ws!.user.name, changes: `Emergency pause: ${body.emergencyPause ? "ON" : "OFF"}`, ctaUrl: appLink(`/app/${ws!.workspace.slug}/settings`) } }, tx);
    }
  });
  return { ok: true };
});
