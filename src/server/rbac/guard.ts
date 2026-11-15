import type { Membership, Role, User, Workspace } from "@/generated/prisma/client";
import { prisma } from "../db";
import { Errors } from "../errors";
import { ALL_PERMISSIONS, type PermissionKey } from "./permissions";

export type WorkspaceContext = {
  user: User;
  workspace: Workspace;
  membership: (Membership & { role: Role }) | null;
  permissions: Set<PermissionKey>;
  rank: number;
  viaPlatform: boolean; // access granted through platform role rather than membership
};

// Super Admins can oversee workspaces read-only without membership. Private Messenger content
// is NOT included — it requires an approved, audited SupportAccessGrant.
const PLATFORM_OVERSIGHT: PermissionKey[] = ["dashboard.view", "comments.read", "analytics.view", "billing.view", "audit.view"];
const SUSPENDED_ALLOWED: PermissionKey[] = ["dashboard.view", "billing.view", "billing.manage"];

export async function loadRolePermissions(roleId: string): Promise<Set<PermissionKey>> {
  const rows = await prisma.rolePermission.findMany({ where: { roleId }, select: { permissionKey: true } });
  return new Set(rows.map((r) => r.permissionKey as PermissionKey));
}

export async function resolveWorkspaceContext(user: User, workspaceRef: string): Promise<WorkspaceContext> {
  const workspace = await prisma.workspace.findFirst({ where: { OR: [{ id: workspaceRef }, { slug: workspaceRef }] } });
  if (!workspace || workspace.status === "CLOSED") throw Errors.notFound("Workspace");

  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    include: { role: true },
  });

  let permissions = new Set<PermissionKey>();
  let rank = 0;
  let viaPlatform = false;

  if (membership && membership.status === "ACTIVE") {
    permissions = await loadRolePermissions(membership.roleId);
    rank = membership.role.rank;
  } else if (user.platformRole === "SUPER_ADMIN" || user.platformRole === "SUPPORT") {
    viaPlatform = true;
    permissions = new Set(PLATFORM_OVERSIGHT);
    const grant = await prisma.supportAccessGrant.findFirst({
      where: { workspaceId: workspace.id, requestedById: user.id, status: "APPROVED", expiresAt: { gt: new Date() } },
    });
    if (grant) permissions.add("inbox.manage").add("inbox.all");
  } else {
    // Do not reveal whether the workspace exists.
    throw Errors.notFound("Workspace");
  }

  if (workspace.status === "SUSPENDED" || workspace.status === "PENDING") {
    permissions = new Set([...permissions].filter((p) => SUSPENDED_ALLOWED.includes(p)));
  }
  return { user, workspace, membership, permissions, rank, viaPlatform };
}

export function can(ctx: WorkspaceContext, permission: PermissionKey) {
  return ctx.permissions.has(permission);
}

export function requirePermission(ctx: WorkspaceContext, ...perms: PermissionKey[]) {
  for (const p of perms) if (!ctx.permissions.has(p)) throw Errors.forbidden(`Missing permission: ${p}`);
}

/**
 * Privilege-escalation guard for role assignment and role editing:
 *  - actor must hold team.manage
 *  - actor cannot assign a role ranked above their own
 *  - actor cannot grant permissions they do not hold themselves
 *  - only an owner can assign the owner role
 */
export function assertCanAssignRole(ctx: WorkspaceContext, target: { rank: number; key: string; permissions: string[] }) {
  requirePermission(ctx, "team.manage");
  if (target.key === "owner" && ctx.membership?.role.key !== "owner") throw Errors.forbidden("Only an owner can assign the owner role");
  if (target.rank > ctx.rank) throw Errors.forbidden("Cannot assign a role more privileged than your own");
  const missing = target.permissions.filter((p) => !ctx.permissions.has(p as PermissionKey));
  if (missing.length) throw Errors.forbidden(`Cannot grant permissions you do not hold: ${missing.join(", ")}`);
}

export function assertCanManageMember(ctx: WorkspaceContext, memberRank: number, memberUserId: string) {
  requirePermission(ctx, "team.manage");
  if (memberUserId === ctx.user.id) throw Errors.forbidden("You cannot change your own role or status");
  if (memberRank > ctx.rank) throw Errors.forbidden("Cannot manage a member more privileged than you");
}

export function isValidPermission(p: string): p is PermissionKey {
  return (ALL_PERMISSIONS as string[]).includes(p);
}

export function requirePlatformAdmin(user: User, allowSupport = false) {
  if (user.platformRole === "SUPER_ADMIN") return;
  if (allowSupport && user.platformRole === "SUPPORT") return;
  throw Errors.forbidden("Platform administrator access required");
}
