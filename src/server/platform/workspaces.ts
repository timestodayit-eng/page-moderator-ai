import type { WorkspaceStatus, WorkspaceType } from "@/generated/prisma/client";
import { prisma, type Tx } from "../db";
import { DEFAULT_ROLES } from "../rbac/permissions";
import { Errors } from "../errors";
import { audit } from "../audit";

export function slugify(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "workspace";
}

async function uniqueSlug(name: string, tx: Tx) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; i < 1000; i++) {
    const exists = await tx.workspace.findUnique({ where: { slug }, select: { id: true } });
    if (!exists) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Creates the default system roles for a workspace (idempotent). */
export async function ensureWorkspaceRoles(workspaceId: string, tx: Tx = prisma) {
  for (const tpl of DEFAULT_ROLES) {
    const role = await tx.role.upsert({
      where: { workspaceId_key: { workspaceId, key: tpl.key } },
      update: { name: tpl.name, description: tpl.description, rank: tpl.rank, isSystem: true },
      create: { workspaceId, key: tpl.key, name: tpl.name, description: tpl.description, rank: tpl.rank, isSystem: true },
    });
    // System roles always reflect the template permissions (customers customise by creating custom roles).
    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    await tx.rolePermission.createMany({ data: tpl.permissions.map((p) => ({ roleId: role.id, permissionKey: p })), skipDuplicates: true });
  }
}

type CreateInput = {
  name: string;
  ownerUserId: string;
  type?: WorkspaceType;
  status?: WorkspaceStatus;
  billingExempt?: boolean;
  slug?: string;
  startTrial?: boolean;
  planKey?: string;
  actorUserId?: string | null;
};

export async function createWorkspace(input: CreateInput, tx: Tx = prisma) {
  const slug = input.slug ?? (await uniqueSlug(input.name, tx));
  const workspace = await tx.workspace.create({
    data: { name: input.name, slug, type: input.type ?? "CUSTOMER", status: input.status ?? "ACTIVE", billingExempt: input.billingExempt ?? input.type === "INTERNAL" },
  });
  await ensureWorkspaceRoles(workspace.id, tx);
  const owner = await tx.role.findUniqueOrThrow({ where: { workspaceId_key: { workspaceId: workspace.id, key: "owner" } } });
  await tx.membership.create({ data: { userId: input.ownerUserId, workspaceId: workspace.id, roleId: owner.id } });

  // Subscription: internal/exempt workspaces still get a record (usage + limits), on the most generous plan.
  const plan =
    (input.planKey ? await tx.plan.findUnique({ where: { key: input.planKey } }) : null) ??
    (await tx.plan.findFirst({ where: { isActive: true, ...(workspace.billingExempt ? { key: "enterprise" } : { key: "starter" }) } })) ??
    (await tx.plan.findFirst({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }));
  if (plan) {
    const now = new Date();
    const trialEnds = new Date(now.getTime() + plan.trialDays * 86_400_000);
    const exempt = workspace.billingExempt;
    await tx.subscription.create({
      data: {
        workspaceId: workspace.id,
        planId: plan.id,
        status: exempt ? "EXEMPT" : input.startTrial && plan.trialDays > 0 ? "TRIALING" : "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: exempt ? new Date(now.getTime() + 365 * 86_400_000) : input.startTrial && plan.trialDays > 0 ? trialEnds : new Date(now.getTime() + 30 * 86_400_000),
        trialEndsAt: !exempt && input.startTrial && plan.trialDays > 0 ? trialEnds : null,
      },
    });
  }
  await audit({ workspaceId: workspace.id, actorUserId: input.actorUserId ?? input.ownerUserId, action: "workspace.created", targetType: "Workspace", targetId: workspace.id, meta: { name: input.name, type: workspace.type } }, tx);
  return workspace;
}

export async function listUserWorkspaces(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId, status: "ACTIVE", workspace: { status: { not: "CLOSED" } } },
    include: { workspace: { select: { id: true, slug: true, name: true, type: true, status: true } }, role: { select: { key: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({ ...m.workspace, role: m.role }));
}

export async function assertWorkspaceActive(workspaceId: string) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { status: true } });
  if (!ws || ws.status !== "ACTIVE") throw Errors.forbidden("Workspace is not active");
}
