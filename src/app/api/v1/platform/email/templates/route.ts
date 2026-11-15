import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";

export const GET = api({ auth: "platform" }, async () => ({ templates: await prisma.emailTemplate.findMany({ orderBy: [{ category: "asc" }, { key: "asc" }, { locale: "asc" }] }) }));

export const PUT = api({ auth: "platform", body: z.object({ key: z.string(), locale: z.enum(["en", "bn"]), subject: z.string().min(1).max(200), body: z.string().min(1).max(10000), ctaLabel: z.string().max(60).nullable().optional(), isActive: z.boolean().optional() }) }, async ({ user, body, ip }) => {
  const existing = await prisma.emailTemplate.findUnique({ where: { key_locale: { key: body.key, locale: body.locale } } });
  if (!existing) throw new Error("Unknown template");
  await prisma.emailTemplate.update({ where: { id: existing.id }, data: { subject: body.subject, body: body.body, ctaLabel: body.ctaLabel ?? existing.ctaLabel, isActive: body.isActive ?? existing.isActive, updatedById: user!.id } });
  await audit({ actorUserId: user!.id, action: "platform.email_template_updated", targetType: "EmailTemplate", targetId: existing.id, ip, meta: { key: body.key, locale: body.locale } });
  return { ok: true };
});
