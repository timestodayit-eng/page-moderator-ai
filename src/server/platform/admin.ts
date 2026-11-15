import type { Prisma, SubscriptionStatus, WorkspaceStatus } from "@/generated/prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { Errors } from "../errors";
import { appLink, queueEmail } from "../email/service";
import { generateToken, sha256 } from "../crypto";
import { hashPassword } from "../auth/password";
import { createWorkspace } from "./workspaces";
import { revokeAllSessions } from "../auth/session";
import { currentPeriod } from "../billing/usage";
import { enqueueOutbox } from "../queue/outbox";

type Meta = { ip?: string | null; userAgent?: string | null };

// ───────────────────────────── Overview ─────────────────────────────

export async function platformOverview() {
  const period = currentPeriod();
  const monthStart = new Date(`${period}-01T00:00:00Z`);
  const [
    workspaces, byStatus, subs, revenue, pendingInvoices, aiCost, pages, commentsTotal, commentsMonth, hidden, replies, conversations, activeUsers, errors, queue, outboxPending, heartbeat,
  ] = await Promise.all([
    prisma.workspace.count({ where: { status: { not: "CLOSED" } } }),
    prisma.workspace.groupBy({ by: ["status"], _count: true }),
    prisma.subscription.groupBy({ by: ["status"], _count: true }),
    prisma.payment.aggregate({ _sum: { amountCents: true }, where: { status: "SUCCEEDED", confirmedAt: { gte: monthStart } } }),
    prisma.invoice.aggregate({ _sum: { totalCents: true }, _count: true, where: { status: "OPEN" } }),
    prisma.aiUsage.aggregate({ _sum: { costMicroUsd: true, tokensIn: true, tokensOut: true }, _count: true, where: { createdAt: { gte: monthStart } } }),
    prisma.connectedPage.count({ where: { status: { not: "DISCONNECTED" } } }),
    prisma.comment.count(),
    prisma.comment.count({ where: { receivedAt: { gte: monthStart } } }),
    prisma.moderationAction.count({ where: { type: "HIDE", actorType: "AI", status: "SUCCEEDED" } }),
    prisma.moderationAction.count({ where: { type: "REPLY", actorType: "AI", status: "SUCCEEDED" } }),
    prisma.conversation.count({ where: { lastMessageAt: { gte: monthStart } } }),
    prisma.session.count({ where: { revokedAt: null, lastSeenAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    prisma.webhookEvent.count({ where: { status: "FAILED" } }),
    prisma.outboundAction.groupBy({ by: ["status"], _count: true }),
    prisma.webhookOutbox.count({ where: { status: "PENDING" } }),
    prisma.platformSetting.findUnique({ where: { key: "worker.heartbeat" } }),
  ]);
  const statusMap = Object.fromEntries(byStatus.map((s) => [s.status, s._count]));
  const subMap = Object.fromEntries(subs.map((s) => [s.status, s._count]));
  const hb = heartbeat ? (heartbeat.value as { at: string; queues?: Record<string, unknown> }) : null;
  return {
    businesses: { total: workspaces, active: statusMap.ACTIVE ?? 0, pending: statusMap.PENDING ?? 0, suspended: statusMap.SUSPENDED ?? 0 },
    subscriptions: { active: subMap.ACTIVE ?? 0, trial: subMap.TRIALING ?? 0, expired: (subMap.EXPIRED ?? 0) + (subMap.CANCELED ?? 0), pastDue: (subMap.PAST_DUE ?? 0) + (subMap.GRACE ?? 0), exempt: subMap.EXEMPT ?? 0 },
    revenue: { monthCents: revenue._sum.amountCents ?? 0, pendingInvoiceCents: pendingInvoices._sum.totalCents ?? 0, pendingInvoices: pendingInvoices._count },
    ai: { costMicroUsd: Number(aiCost._sum.costMicroUsd ?? 0n), requests: aiCost._count, tokens: (aiCost._sum.tokensIn ?? 0) + (aiCost._sum.tokensOut ?? 0) },
    moderation: { pages, commentsTotal, commentsMonth, autoHidden: hidden, aiReplies: replies, conversationsMonth: conversations },
    system: {
      activeUsers24h: activeUsers,
      webhookFailures: errors,
      outboundQueue: Object.fromEntries(queue.map((q) => [q.status, q._count])),
      outboxPending,
      worker: { alive: hb ? Date.now() - new Date(hb.at).getTime() < 120_000 : false, lastHeartbeat: hb?.at ?? null, queues: hb?.queues ?? null },
    },
  };
}

// ───────────────────────────── Workspaces / customers ─────────────────────────────

export async function listWorkspaces(q: { search?: string; status?: string; type?: string; plan?: string; skip: number; take: number }) {
  const where: Prisma.WorkspaceWhereInput = {
    ...(q.search ? { OR: [{ name: { contains: q.search, mode: "insensitive" } }, { slug: { contains: q.search, mode: "insensitive" } }, { memberships: { some: { user: { email: { contains: q.search, mode: "insensitive" } } } } }] } : {}),
    ...(q.status ? { status: q.status as WorkspaceStatus } : {}),
    ...(q.type ? { type: q.type as "INTERNAL" | "CUSTOMER" } : {}),
    ...(q.plan ? { subscription: { plan: { key: q.plan } } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.workspace.count({ where }),
    prisma.workspace.findMany({
      where,
      skip: q.skip,
      take: q.take,
      orderBy: { createdAt: "desc" },
      include: {
        subscription: { include: { plan: { select: { key: true, name: true } } } },
        _count: { select: { memberships: true, pages: true } },
        memberships: { where: { role: { key: "owner" } }, take: 1, include: { user: { select: { email: true, name: true } } } },
      },
    }),
  ]);
  return { total, rows: rows.map((w) => ({ id: w.id, slug: w.slug, name: w.name, type: w.type, status: w.status, billingExempt: w.billingExempt, createdAt: w.createdAt, plan: w.subscription?.plan ?? null, subscriptionStatus: w.subscription?.status ?? null, periodEnd: w.subscription?.currentPeriodEnd ?? null, members: w._count.memberships, pages: w._count.pages, owner: w.memberships[0]?.user ?? null })) };
}

export async function workspaceDetail(id: string) {
  const ws = await prisma.workspace.findUnique({
    where: { id },
    include: {
      subscription: { include: { plan: true } },
      memberships: { include: { user: { select: { id: true, email: true, name: true, status: true, lastLoginAt: true } }, role: { select: { key: true, name: true } } } },
      pages: { select: { id: true, name: true, fbPageId: true, status: true, moderationMode: true, autoHideEnabled: true, connectedAt: true } },
      invoices: { orderBy: { createdAt: "desc" }, take: 10 },
      aiCredentials: { select: { id: true, provider: true, keyLast4: true, status: true } },
    },
  });
  if (!ws) throw Errors.notFound("Workspace");
  const period = currentPeriod();
  const usage = await prisma.usageCounter.findMany({ where: { workspaceId: id, period } });
  const audit = await prisma.auditLog.findMany({ where: { workspaceId: id }, orderBy: { createdAt: "desc" }, take: 30 });
  return { ...ws, usage: Object.fromEntries(usage.map((u) => [u.metric, Number(u.value)])), recentAudit: audit };
}

export async function adminCreateWorkspace(actorId: string, input: { name: string; ownerEmail: string; ownerName: string; type: "INTERNAL" | "CUSTOMER"; planKey?: string; billingExempt?: boolean }, meta: Meta) {
  const email = input.ownerEmail.trim().toLowerCase();
  return prisma.$transaction(async (tx) => {
    let owner = await tx.user.findUnique({ where: { email } });
    let setupToken: string | null = null;
    if (!owner) {
      // Random unusable password; the owner sets theirs through the setup (reset) link.
      owner = await tx.user.create({ data: { email, name: input.ownerName.trim(), passwordHash: await hashPassword(generateToken(24)), emailVerifiedAt: new Date() } });
      setupToken = generateToken();
      await tx.passwordResetToken.create({ data: { userId: owner.id, tokenHash: sha256(setupToken), expiresAt: new Date(Date.now() + 3 * 86_400_000) } });
    }
    const ws = await createWorkspace({ name: input.name, ownerUserId: owner.id, type: input.type, billingExempt: input.billingExempt ?? input.type === "INTERNAL", planKey: input.planKey, startTrial: input.type === "CUSTOMER", actorUserId: actorId }, tx);
    await queueEmail(
      { to: email, templateKey: "account.created", workspaceId: ws.id, userId: owner.id, locale: owner.locale, vars: { name: owner.name, workspaceName: ws.name, ctaUrl: setupToken ? appLink(`/reset-password?token=${setupToken}&setup=1`) : appLink(`/app/${ws.slug}`) }, createdById: actorId },
      tx,
    );
    await audit({ workspaceId: ws.id, actorUserId: actorId, action: "platform.workspace_created", targetType: "Workspace", targetId: ws.id, ip: meta.ip, meta: { ownerEmail: email, type: input.type } }, tx);
    return ws;
  });
}

export async function setWorkspaceStatus(actorId: string, id: string, status: WorkspaceStatus, reason: string, meta: Meta) {
  const ws = await prisma.workspace.findUnique({ where: { id }, include: { memberships: { where: { role: { key: "owner" } }, include: { user: true } } } });
  if (!ws) throw Errors.notFound("Workspace");
  await prisma.$transaction(async (tx) => {
    await tx.workspace.update({ where: { id }, data: { status, ...(status === "SUSPENDED" ? { emergencyPause: true } : {}) } });
    if (status === "SUSPENDED") {
      await tx.outboundAction.updateMany({ where: { workspaceId: id, status: "PENDING" }, data: { status: "CANCELLED", lastError: "workspace suspended" } });
      await tx.subscription.updateMany({ where: { workspaceId: id, status: { in: ["ACTIVE", "TRIALING", "GRACE", "PAST_DUE"] } }, data: { status: "SUSPENDED" } });
    }
    if (status === "ACTIVE" && ws.status !== "ACTIVE") {
      await tx.workspace.update({ where: { id }, data: { emergencyPause: false } });
      const sub = await tx.subscription.findUnique({ where: { workspaceId: id } });
      if (sub?.status === "SUSPENDED") await tx.subscription.update({ where: { workspaceId: id }, data: { status: ws.billingExempt ? "EXEMPT" : sub.currentPeriodEnd > new Date() ? "ACTIVE" : "EXPIRED" } });
    }
    const tplKey = status === "SUSPENDED" ? "account.suspended" : status === "ACTIVE" ? "account.approved" : null;
    if (tplKey) {
      for (const m of ws.memberships) {
        await queueEmail({ to: m.user.email, templateKey: tplKey, workspaceId: id, userId: m.userId, locale: m.user.locale, vars: { name: m.user.name, workspaceName: ws.name, reason, ctaUrl: appLink(`/app/${ws.slug}`) }, createdById: actorId }, tx);
      }
    }
    await audit({ workspaceId: id, actorUserId: actorId, action: `platform.workspace_${status.toLowerCase()}`, targetType: "Workspace", targetId: id, ip: meta.ip, meta: { reason, from: ws.status } }, tx);
  });
}

export async function updateWorkspaceAdmin(actorId: string, id: string, patch: { name?: string; type?: "INTERNAL" | "CUSTOMER"; billingExempt?: boolean; servicesEnabled?: Record<string, boolean>; emergencyPause?: boolean; allowPlatformFallback?: boolean }, meta: Meta) {
  const ws = await prisma.workspace.findUnique({ where: { id } });
  if (!ws) throw Errors.notFound("Workspace");
  await prisma.$transaction(async (tx) => {
    await tx.workspace.update({ where: { id }, data: { ...patch, servicesEnabled: patch.servicesEnabled ? { ...(ws.servicesEnabled as object), ...patch.servicesEnabled } : undefined } });
    if (patch.billingExempt !== undefined && patch.billingExempt !== ws.billingExempt) {
      await tx.subscription.updateMany({ where: { workspaceId: id }, data: { status: patch.billingExempt ? "EXEMPT" : "ACTIVE" } });
    }
    await audit({ workspaceId: id, actorUserId: actorId, action: "platform.workspace_updated", targetType: "Workspace", targetId: id, ip: meta.ip, meta: { patch } }, tx);
  });
}

// ───────────────────────────── Users ─────────────────────────────

export async function listUsers(q: { search?: string; status?: string; platformRole?: string; skip: number; take: number }) {
  const where: Prisma.UserWhereInput = {
    ...(q.search ? { OR: [{ email: { contains: q.search, mode: "insensitive" } }, { name: { contains: q.search, mode: "insensitive" } }, { memberships: { some: { workspace: { name: { contains: q.search, mode: "insensitive" } } } } }] } : {}),
    ...(q.status ? { status: q.status as "ACTIVE" | "SUSPENDED" } : {}),
    ...(q.platformRole ? { platformRole: q.platformRole as "NONE" | "SUPPORT" | "SUPER_ADMIN" } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip: q.skip,
      take: q.take,
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, name: true, status: true, platformRole: true, emailVerifiedAt: true, lastLoginAt: true, createdAt: true, failedLoginCount: true, lockedUntil: true, memberships: { select: { workspace: { select: { id: true, name: true, slug: true } }, role: { select: { key: true, name: true } }, status: true } }, _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } } } },
    }),
  ]);
  return { total, rows };
}

export async function userDetail(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, status: true, platformRole: true, locale: true, emailVerifiedAt: true, lastLoginAt: true, createdAt: true, mfaEnabled: true, failedLoginCount: true, lockedUntil: true, passwordChangedAt: true, memberships: { include: { workspace: { select: { id: true, name: true, slug: true, status: true } }, role: { select: { id: true, key: true, name: true } } } }, sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true } } },
  });
  if (!user) throw Errors.notFound("User");
  const activity = await prisma.auditLog.findMany({ where: { actorUserId: id }, orderBy: { createdAt: "desc" }, take: 50 });
  const security = await prisma.auditLog.findMany({ where: { OR: [{ actorUserId: id }, { meta: { path: ["email"], equals: user.email } }], action: { in: ["auth.login_failed", "auth.password_reset_requested", "auth.password_reset_completed", "auth.sessions_revoked"] } }, orderBy: { createdAt: "desc" }, take: 30 });
  return { user, activity, security };
}

export async function adminUpdateUser(actorId: string, actorRole: string, id: string, patch: { status?: "ACTIVE" | "SUSPENDED"; platformRole?: "NONE" | "SUPPORT" | "SUPER_ADMIN"; name?: string }, meta: Meta) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw Errors.notFound("User");
  if (id === actorId && (patch.status === "SUSPENDED" || (patch.platformRole && patch.platformRole !== "SUPER_ADMIN"))) throw Errors.forbidden("You cannot suspend or demote yourself");
  if (patch.platformRole && actorRole !== "SUPER_ADMIN") throw Errors.forbidden("Only Super Admins can change platform roles");
  if (patch.platformRole === "SUPER_ADMIN" || user.platformRole === "SUPER_ADMIN") {
    // Privileged access changes are always audited with a distinct action.
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: patch });
    if (patch.status === "SUSPENDED") await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "admin_suspended" } });
    await audit({ actorUserId: actorId, action: patch.platformRole ? "platform.privileged_access_changed" : "platform.user_updated", targetType: "User", targetId: id, ip: meta.ip, meta: { patch, before: { status: user.status, platformRole: user.platformRole } } }, tx);
  });
}

export async function adminRevokeSessions(actorId: string, userId: string, meta: Meta) {
  const count = await revokeAllSessions(userId, "admin_revoked");
  await audit({ actorUserId: actorId, action: "platform.sessions_revoked", targetType: "User", targetId: userId, ip: meta.ip, meta: { count } });
  return count;
}

export async function adminTriggerPasswordReset(actorId: string, userId: string, meta: Meta) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Errors.notFound("User");
  const raw = generateToken();
  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
    await tx.passwordResetToken.create({ data: { userId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 30 * 60_000) } });
    await queueEmail({ to: user.email, templateKey: "auth.forgot_password", userId, locale: user.locale, vars: { name: user.name, expiresMinutes: 30, ctaUrl: appLink(`/reset-password?token=${raw}`) }, createdById: actorId }, tx);
    await audit({ actorUserId: actorId, action: "platform.password_reset_triggered", targetType: "User", targetId: userId, ip: meta.ip }, tx);
  });
}

export async function adminSetMembership(actorId: string, input: { userId: string; workspaceId: string; roleKey: string | null }, meta: Meta) {
  const ws = await prisma.workspace.findUnique({ where: { id: input.workspaceId } });
  if (!ws) throw Errors.notFound("Workspace");
  await prisma.$transaction(async (tx) => {
    if (!input.roleKey) {
      await tx.membership.deleteMany({ where: { userId: input.userId, workspaceId: input.workspaceId } });
    } else {
      const role = await tx.role.findUnique({ where: { workspaceId_key: { workspaceId: input.workspaceId, key: input.roleKey } } });
      if (!role) throw Errors.notFound("Role");
      await tx.membership.upsert({ where: { userId_workspaceId: { userId: input.userId, workspaceId: input.workspaceId } }, update: { roleId: role.id, status: "ACTIVE" }, create: { userId: input.userId, workspaceId: input.workspaceId, roleId: role.id } });
    }
    await audit({ workspaceId: input.workspaceId, actorUserId: actorId, action: "platform.membership_set", targetType: "User", targetId: input.userId, ip: meta.ip, meta: { roleKey: input.roleKey } }, tx);
  });
}

// ───────────────────────────── Plans & subscriptions ─────────────────────────────

export async function upsertPlan(actorId: string, input: { id?: string; key: string; name: string; description?: string; priceMonthlyCents: number; priceYearlyCents: number; trialDays: number; limits: Record<string, number>; features: string[]; isPublic: boolean; isActive: boolean; sortOrder?: number }, meta: Meta) {
  const data = { key: input.key, name: input.name, description: input.description ?? "", priceMonthlyCents: input.priceMonthlyCents, priceYearlyCents: input.priceYearlyCents, trialDays: input.trialDays, limits: input.limits, features: input.features, isPublic: input.isPublic, isActive: input.isActive, sortOrder: input.sortOrder ?? 0 };
  const plan = input.id ? await prisma.plan.update({ where: { id: input.id }, data }) : await prisma.plan.create({ data });
  await audit({ actorUserId: actorId, action: input.id ? "platform.plan_updated" : "platform.plan_created", targetType: "Plan", targetId: plan.id, ip: meta.ip, meta: { key: plan.key } });
  return plan;
}

export async function adminSetSubscription(actorId: string, workspaceId: string, input: { planKey?: string; status?: SubscriptionStatus; extendDays?: number; trialExtendDays?: number; limitOverrides?: Record<string, number>; discountPercent?: number; cancelAtPeriodEnd?: boolean }, meta: Meta) {
  const sub = await prisma.subscription.findUnique({ where: { workspaceId }, include: { plan: true, workspace: { include: { memberships: { where: { role: { key: "owner" } }, include: { user: true } } } } } });
  if (!sub) throw Errors.notFound("Subscription");
  const data: Prisma.SubscriptionUpdateInput = {};
  let newPlanName: string | null = null;
  let direction: string | null = null;
  if (input.planKey && input.planKey !== sub.plan.key) {
    const plan = await prisma.plan.findUnique({ where: { key: input.planKey } });
    if (!plan) throw Errors.notFound("Plan");
    data.plan = { connect: { id: plan.id } };
    newPlanName = plan.name;
    direction = plan.sortOrder > sub.plan.sortOrder ? "upgraded" : "downgraded";
  }
  if (input.status) data.status = input.status;
  if (input.extendDays) data.currentPeriodEnd = new Date(sub.currentPeriodEnd.getTime() + input.extendDays * 86_400_000);
  if (input.trialExtendDays) {
    const base = sub.trialEndsAt && sub.trialEndsAt > new Date() ? sub.trialEndsAt : new Date();
    const t = new Date(base.getTime() + input.trialExtendDays * 86_400_000);
    data.trialEndsAt = t;
    data.currentPeriodEnd = t;
    data.status = "TRIALING";
  }
  if (input.limitOverrides) data.limitOverrides = input.limitOverrides;
  if (input.discountPercent !== undefined) data.discountPercent = input.discountPercent;
  if (input.cancelAtPeriodEnd !== undefined) data.cancelAtPeriodEnd = input.cancelAtPeriodEnd;
  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({ where: { workspaceId }, data });
    if (newPlanName) {
      for (const m of sub.workspace.memberships) {
        await queueEmail({ to: m.user.email, templateKey: "subscription.changed", workspaceId, userId: m.userId, locale: m.user.locale, vars: { name: m.user.name, workspaceName: sub.workspace.name, planName: newPlanName, direction: direction!, ctaUrl: appLink(`/app/${sub.workspace.slug}/billing`) }, createdById: actorId }, tx);
      }
    }
    await audit({ workspaceId, actorUserId: actorId, action: "platform.subscription_updated", targetType: "Subscription", targetId: sub.id, ip: meta.ip, meta: { input } }, tx);
  });
}

// ───────────────────────────── Settings ─────────────────────────────

export const SETTING_KEYS = ["branding", "registration", "ai", "moderation", "security", "retention", "features", "notifications", "email"] as const;

export async function getSettings() {
  const rows = await prisma.platformSetting.findMany({ where: { key: { in: [...SETTING_KEYS] } } });
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function updateSetting(actorId: string, key: (typeof SETTING_KEYS)[number], value: Record<string, unknown>, meta: Meta) {
  const before = await prisma.platformSetting.findUnique({ where: { key } });
  await prisma.platformSetting.upsert({ where: { key }, update: { value: value as Prisma.InputJsonValue, updatedById: actorId }, create: { key, value: value as Prisma.InputJsonValue, updatedById: actorId } });
  await audit({ actorUserId: actorId, action: "platform.setting_updated", targetType: "PlatformSetting", targetId: key, ip: meta.ip, meta: { before: before?.value ?? null, after: value } });
}

// ───────────────────────────── Audit & support access ─────────────────────────────

export async function listAuditLogs(q: { workspaceId?: string; actorUserId?: string; action?: string; from?: Date; to?: Date; skip: number; take: number }) {
  const where: Prisma.AuditLogWhereInput = {
    ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
    ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
    ...(q.action ? { action: { contains: q.action } } : {}),
    ...(q.from || q.to ? { createdAt: { gte: q.from, lte: q.to } } : {}),
  };
  const [total, rows] = await Promise.all([prisma.auditLog.count({ where }), prisma.auditLog.findMany({ where, skip: q.skip, take: q.take, orderBy: { createdAt: "desc" }, include: { workspace: { select: { name: true, slug: true } } } })]);
  const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter(Boolean))] as string[];
  const actors = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true, name: true } });
  const actorMap = Object.fromEntries(actors.map((a) => [a.id, a]));
  return { total, rows: rows.map((r) => ({ ...r, actor: r.actorUserId ? actorMap[r.actorUserId] ?? null : null })) };
}

export async function requestSupportAccess(actorId: string, workspaceId: string, reason: string, scope: string, meta: Meta) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, include: { memberships: { where: { role: { key: "owner" } }, include: { user: true } } } });
  if (!ws) throw Errors.notFound("Workspace");
  const grant = await prisma.$transaction(async (tx) => {
    const g = await tx.supportAccessGrant.create({ data: { workspaceId, requestedById: actorId, reason, scope } });
    for (const m of ws.memberships) {
      await tx.notification.create({ data: { workspaceId, userId: m.userId, type: "SUPPORT_ACCESS_REQUEST", title: "Support access requested", body: `Platform support requested ${scope} access: ${reason}`, link: `/app/${ws.slug}/settings/security` } });
    }
    await audit({ workspaceId, actorUserId: actorId, action: "support.access_requested", targetType: "SupportAccessGrant", targetId: g.id, ip: meta.ip, meta: { reason, scope } }, tx);
    return g;
  });
  return grant;
}

/** Workspace owner approves/denies a support access request (time-boxed). */
export async function decideSupportAccess(ownerId: string, workspaceId: string, grantId: string, approve: boolean, hours: number, meta: Meta) {
  const g = await prisma.supportAccessGrant.findFirst({ where: { id: grantId, workspaceId, status: "REQUESTED" } });
  if (!g) throw Errors.notFound("Access request");
  await prisma.$transaction(async (tx) => {
    await tx.supportAccessGrant.update({ where: { id: grantId }, data: { status: approve ? "APPROVED" : "DENIED", approvedById: ownerId, approvedAt: new Date(), expiresAt: approve ? new Date(Date.now() + Math.min(hours, 72) * 3600_000) : null } });
    await audit({ workspaceId, actorUserId: ownerId, action: approve ? "support.access_approved" : "support.access_denied", targetType: "SupportAccessGrant", targetId: grantId, ip: meta.ip, meta: { hours } }, tx);
  });
}

export async function revokeSupportAccess(actorId: string, grantId: string, meta: Meta) {
  const g = await prisma.supportAccessGrant.findUnique({ where: { id: grantId } });
  if (!g) throw Errors.notFound("Access grant");
  await prisma.supportAccessGrant.update({ where: { id: grantId }, data: { status: "REVOKED", expiresAt: new Date() } });
  await audit({ workspaceId: g.workspaceId, actorUserId: actorId, action: "support.access_revoked", targetType: "SupportAccessGrant", targetId: grantId, ip: meta.ip });
}

// ───────────────────────────── Email center ─────────────────────────────

export async function resolveRecipients(filter: { workspaceIds?: string[]; roles?: string[]; allOwners?: boolean; status?: WorkspaceStatus[] }) {
  const memberships = await prisma.membership.findMany({
    where: {
      status: "ACTIVE",
      user: { status: "ACTIVE" },
      workspace: { status: filter.status?.length ? { in: filter.status } : { not: "CLOSED" }, ...(filter.workspaceIds?.length ? { id: { in: filter.workspaceIds } } : {}) },
      role: filter.allOwners ? { key: "owner" } : filter.roles?.length ? { key: { in: filter.roles } } : { key: "owner" },
    },
    include: { user: { select: { id: true, email: true, name: true, locale: true } }, workspace: { select: { id: true, name: true, slug: true } } },
  });
  const seen = new Set<string>();
  return memberships.filter((m) => (seen.has(`${m.userId}:${m.workspaceId}`) ? false : (seen.add(`${m.userId}:${m.workspaceId}`), true)));
}

export async function createCampaign(actorId: string, input: { name: string; templateKey: string; recipientFilter: { workspaceIds?: string[]; roles?: string[]; allOwners?: boolean }; vars: Record<string, string>; scheduledAt?: Date | null; sendNow?: boolean }, meta: Meta) {
  const recipients = await resolveRecipients(input.recipientFilter);
  const campaign = await prisma.$transaction(async (tx) => {
    const c = await tx.emailCampaign.create({
      data: { name: input.name, templateKey: input.templateKey, recipientFilter: input.recipientFilter, vars: input.vars, status: input.sendNow ? "SENDING" : input.scheduledAt ? "SCHEDULED" : "DRAFT", scheduledAt: input.scheduledAt ?? (input.sendNow ? new Date() : null), recipientCount: recipients.length, createdById: actorId },
    });
    if (input.sendNow || input.scheduledAt) {
      for (const r of recipients) {
        await queueEmail(
          { to: r.user.email, templateKey: input.templateKey, workspaceId: r.workspaceId, userId: r.userId, locale: r.user.locale, campaignId: c.id, scheduledAt: input.scheduledAt ?? undefined, vars: { ...input.vars, name: r.user.name, workspaceName: r.workspace.name, ctaUrl: input.vars.ctaUrl ?? appLink(`/app/${r.workspace.slug}`) }, createdById: actorId },
          tx,
        );
      }
      if (input.sendNow) await tx.emailCampaign.update({ where: { id: c.id }, data: { status: "SENT", sentAt: new Date() } });
    }
    await audit({ actorUserId: actorId, action: "platform.email_campaign_created", targetType: "EmailCampaign", targetId: c.id, ip: meta.ip, meta: { recipients: recipients.length, templateKey: input.templateKey } }, tx);
    return c;
  });
  return { campaign, recipients: recipients.length };
}

export async function sendTestEmail(actorId: string, input: { to: string; templateKey: string; locale: string; vars: Record<string, string> }) {
  return queueEmail({ to: input.to, templateKey: input.templateKey, locale: input.locale, userId: actorId, vars: { name: "Test Recipient", workspaceName: "Example Business", ctaUrl: appLink("/"), ...input.vars }, createdById: actorId });
}

export async function retryDelivery(actorId: string, deliveryId: string) {
  const d = await prisma.emailDelivery.findUnique({ where: { id: deliveryId } });
  if (!d) throw Errors.notFound("Delivery");
  if (d.status !== "FAILED") throw Errors.conflict("Only failed deliveries can be retried");
  if (!d.varsEnc) throw Errors.conflict("Delivery variables were purged; re-send from the template instead");
  await prisma.$transaction(async (tx) => {
    await tx.emailDelivery.update({ where: { id: deliveryId }, data: { status: "QUEUED", lastError: null } });
    await enqueueOutbox("email.send", { deliveryId }, tx);
    await audit({ actorUserId: actorId, action: "platform.email_retry", targetType: "EmailDelivery", targetId: deliveryId }, tx);
  });
}

export async function listDeliveries(q: { status?: string; workspaceId?: string; search?: string; campaignId?: string; skip: number; take: number }) {
  const where: Prisma.EmailDeliveryWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
    ...(q.campaignId ? { campaignId: q.campaignId } : {}),
    ...(q.search ? { OR: [{ toEmail: { contains: q.search, mode: "insensitive" } }, { templateKey: { contains: q.search } }] } : {}),
  };
  const [total, rows, stats] = await Promise.all([
    prisma.emailDelivery.count({ where }),
    prisma.emailDelivery.findMany({ where, skip: q.skip, take: q.take, orderBy: { createdAt: "desc" }, select: { id: true, toEmail: true, templateKey: true, locale: true, category: true, subject: true, status: true, attempts: true, lastError: true, provider: true, scheduledAt: true, sentAt: true, createdAt: true, workspaceId: true, campaignId: true } }),
    prisma.emailDelivery.groupBy({ by: ["status"], _count: true, where: { createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
  ]);
  return { total, rows, stats: Object.fromEntries(stats.map((s) => [s.status, s._count])) };
}
