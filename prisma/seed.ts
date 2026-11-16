/**
 * Idempotent seed: permissions catalogue, system role templates, default plans, email templates and
 * platform settings. Safe to run repeatedly (uses upserts). Does NOT create users — see scripts/bootstrap-admin.ts.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PERMISSIONS, DEFAULT_ROLES } from "../src/server/rbac/permissions";
import { DEFAULT_PLANS } from "../src/server/billing/plans";
import { TEMPLATES } from "../src/server/email/templates";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

export async function seed() {
  for (const [key, meta] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({ where: { key }, update: { group: meta.group, description: meta.description }, create: { key, group: meta.group, description: meta.description } });
  }
  // System role templates (workspaceId = null) — used as the source when provisioning workspaces.
  for (const tpl of DEFAULT_ROLES) {
    const existing = await prisma.role.findFirst({ where: { workspaceId: null, key: tpl.key } });
    const role = existing
      ? await prisma.role.update({ where: { id: existing.id }, data: { name: tpl.name, description: tpl.description, rank: tpl.rank, isSystem: true } })
      : await prisma.role.create({ data: { workspaceId: null, key: tpl.key, name: tpl.name, description: tpl.description, rank: tpl.rank, isSystem: true } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({ data: tpl.permissions.map((p) => ({ roleId: role.id, permissionKey: p })) });
  }
  for (const p of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { key: p.key },
      update: { description: p.description, limits: p.limits, features: p.features, sortOrder: p.sortOrder },
      create: { key: p.key, name: p.name, description: p.description, priceMonthlyCents: p.priceMonthlyCents, priceYearlyCents: p.priceYearlyCents, trialDays: p.trialDays, limits: p.limits, features: p.features, sortOrder: p.sortOrder, isPublic: p.isPublic },
    });
  }
  for (const t of TEMPLATES) {
    for (const locale of ["en", "bn"] as const) {
      const v = t[locale];
      await prisma.emailTemplate.upsert({
        where: { key_locale: { key: t.key, locale } },
        update: {},
        create: { key: t.key, locale, category: t.category, subject: v.subject, body: v.body, ctaLabel: v.ctaLabel ?? null },
      });
    }
  }
  const settings: Record<string, unknown> = {
    branding: { appName: process.env.APP_NAME ?? "Page Moderator AI", brandColor: "#2563EB" },
    registration: { enabled: true, requireApproval: false, allowedDomains: [] },
    ai: { defaultProvider: process.env.DEFAULT_AI_PROVIDER ?? "openai", monthlyPlatformBudgetMicroUsd: 500_000_000, warnAtPercent: 80 },
    moderation: { globalMaxAutoHidesPerPagePerHour: 60, minAutoHideConfidence: 0.85, autoHideAllowedCategories: ["SPAM", "SCAM", "SUSPICIOUS_LINK", "REPEATED_PROMO", "DEFAMATION", "ABUSE", "HARASSMENT", "HATE_SPEECH", "PII_EXPOSURE", "HIGH_RISK", "NEGATIVE", "COMPLAINT"] },
    security: { sessionTtlHours: 336, maxFailedLogins: 8, requireEmailVerification: true },
    retention: { commentsDays: 365, messagesDays: 365, auditDays: 730, webhookEventsDays: 30 },
    features: { messenger: true, crm: true, billing: true, byok: true },
    notifications: { ownersOnModerationIncidents: true, usageWarnings: true },
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.platformSetting.upsert({ where: { key }, update: {}, create: { key, value: value as object } });
  }
}

const isMain = process.argv[1] && /seed\.ts$/.test(process.argv[1]);
if (isMain) {
  seed()
    .then(() => console.log("Seed complete"))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
