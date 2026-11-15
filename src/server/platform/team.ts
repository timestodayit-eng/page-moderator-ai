import { prisma } from "../db";
import { audit } from "../audit";
import { Errors } from "../errors";
import { generateToken, sha256 } from "../crypto";
import { appLink, queueEmail } from "../email/service";
import { assertCanAssignRole, assertCanManageMember, isValidPermission, loadRolePermissions, type WorkspaceContext } from "../rbac/guard";
import { DEFAULT_ROLES, type PermissionKey } from "../rbac/permissions";
import { enforceLimit } from "../billing/usage";

const INVITE_TTL_DAYS = 7;

export async function listMembers(workspaceId: string) {
  const members = await prisma.membership.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, email: true, name: true, status: true, lastLoginAt: true, emailVerifiedAt: true } }, role: { select: { id: true, key: true, name: true, rank: true } } },
    orderBy: { createdAt: "asc" },
  });
  const invitations = await prisma.invitation.findMany({
    where: { workspaceId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { role: { select: { key: true, name: true } }, invitedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return { members, invitations };
}

export async function listRoles(workspaceId: string) {
  const roles = await prisma.role.findMany({ where: { workspaceId }, include: { permissions: { select: { permissionKey: true } }, _count: { select: { memberships: true } } }, orderBy: { rank: "desc" } });
  return roles.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, rank: r.rank, isSystem: r.isSystem, members: r._count.memberships, permissions: r.permissions.map((p) => p.permissionKey) }));
}

export async function createRole(ctx: WorkspaceContext, input: { name: string; description?: string; permissions: string[] }, meta: { ip?: string | null }) {
  const perms = input.permissions.filter(isValidPermission);
  if (perms.length !== input.permissions.length) throw Errors.badRequest("Unknown permission key");
  const rank = Math.min(ctx.rank - 1, 79);
  assertCanAssignRole(ctx, { key: "custom", rank, permissions: perms });
  const key = `custom-${generateToken(4).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6)}`;
  const role = await prisma.$transaction(async (tx) => {
    const r = await tx.role.create({ data: { workspaceId: ctx.workspace.id, key, name: input.name.trim(), description: input.description?.trim() ?? "", rank, isSystem: false } });
    await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: r.id, permissionKey: p })) });
    await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "role.created", targetType: "Role", targetId: r.id, ip: meta.ip, meta: { name: r.name, permissions: perms } }, tx);
    return r;
  });
  return role;
}

export async function updateRole(ctx: WorkspaceContext, roleId: string, input: { name?: string; description?: string; permissions?: string[] }, meta: { ip?: string | null }) {
  const role = await prisma.role.findFirst({ where: { id: roleId, workspaceId: ctx.workspace.id } });
  if (!role) throw Errors.notFound("Role");
  if (role.key === "owner") throw Errors.forbidden("The owner role cannot be modified");
  if (role.rank > ctx.rank) throw Errors.forbidden("Cannot modify a role more privileged than your own");
  const before = [...(await loadRolePermissions(roleId))];
  let perms: PermissionKey[] | undefined;
  if (input.permissions) {
    perms = input.permissions.filter(isValidPermission);
    if (perms.length !== input.permissions.length) throw Errors.badRequest("Unknown permission key");
    assertCanAssignRole(ctx, { key: role.key, rank: role.rank, permissions: perms });
  }
  await prisma.$transaction(async (tx) => {
    await tx.role.update({ where: { id: roleId }, data: { name: input.name?.trim(), description: input.description?.trim(), isSystem: role.isSystem && !perms ? role.isSystem : false } });
    if (perms) {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionKey: p })) });
    }
    await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "role.updated", targetType: "Role", targetId: roleId, ip: meta.ip, meta: { before, after: perms ?? before, name: input.name } }, tx);
  });
}

export async function deleteRole(ctx: WorkspaceContext, roleId: string, meta: { ip?: string | null }) {
  const role = await prisma.role.findFirst({ where: { id: roleId, workspaceId: ctx.workspace.id }, include: { _count: { select: { memberships: true, invitations: true } } } });
  if (!role) throw Errors.notFound("Role");
  if (role.isSystem || DEFAULT_ROLES.some((r) => r.key === role.key)) throw Errors.forbidden("System roles cannot be deleted");
  if (role._count.memberships > 0) throw Errors.conflict("Reassign members before deleting this role");
  await prisma.$transaction(async (tx) => {
    await tx.invitation.updateMany({ where: { roleId, acceptedAt: null }, data: { revokedAt: new Date() } });
    await tx.role.delete({ where: { id: roleId } });
    await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "role.deleted", targetType: "Role", targetId: roleId, ip: meta.ip, meta: { name: role.name } }, tx);
  });
}

export async function inviteMember(ctx: WorkspaceContext, input: { email: string; roleId: string }, meta: { ip?: string | null }) {
  const email = input.email.trim().toLowerCase();
  const role = await prisma.role.findFirst({ where: { id: input.roleId, workspaceId: ctx.workspace.id } });
  if (!role) throw Errors.notFound("Role");
  const perms = [...(await loadRolePermissions(role.id))];
  assertCanAssignRole(ctx, { key: role.key, rank: role.rank, permissions: perms });

  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) {
    const m = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: existingUser.id, workspaceId: ctx.workspace.id } } });
    if (m) throw Errors.conflict("This person is already a member of the workspace");
  }
  const memberCount = await prisma.membership.count({ where: { workspaceId: ctx.workspace.id } });
  const pending = await prisma.invitation.count({ where: { workspaceId: ctx.workspace.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
  await enforceLimit(ctx.workspace.id, "users", memberCount + pending + 1);

  const raw = generateToken();
  const invitation = await prisma.$transaction(async (tx) => {
    await tx.invitation.updateMany({ where: { workspaceId: ctx.workspace.id, email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const inv = await tx.invitation.create({
      data: { workspaceId: ctx.workspace.id, email, roleId: role.id, tokenHash: sha256(raw), invitedById: ctx.user.id, expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000) },
    });
    await queueEmail(
      {
        to: email,
        templateKey: "account.invitation",
        workspaceId: ctx.workspace.id,
        locale: ctx.workspace.defaultLocale,
        vars: { inviterName: ctx.user.name, workspaceName: ctx.workspace.name, roleName: role.name, expiresDays: INVITE_TTL_DAYS, ctaUrl: appLink(`/invite?token=${raw}`) },
        createdById: ctx.user.id,
      },
      tx,
    );
    await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "member.invited", targetType: "Invitation", targetId: inv.id, ip: meta.ip, meta: { email, role: role.key } }, tx);
    return inv;
  });
  return invitation;
}

export async function revokeInvitation(ctx: WorkspaceContext, invitationId: string, meta: { ip?: string | null }) {
  const inv = await prisma.invitation.findFirst({ where: { id: invitationId, workspaceId: ctx.workspace.id } });
  if (!inv) throw Errors.notFound("Invitation");
  await prisma.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
  await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "member.invitation_revoked", targetType: "Invitation", targetId: inv.id, ip: meta.ip });
}

/** Public preview of an invitation (no secrets). */
export async function previewInvitation(rawToken: string) {
  const inv = await prisma.invitation.findUnique({ where: { tokenHash: sha256(rawToken) }, include: { workspace: { select: { name: true } }, role: { select: { name: true } }, invitedBy: { select: { name: true } } } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= new Date()) throw Errors.badRequest("This invitation is invalid or has expired");
  const user = await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } });
  return { email: inv.email, workspaceName: inv.workspace.name, roleName: inv.role.name, inviterName: inv.invitedBy.name, accountExists: Boolean(user) };
}

/**
 * Accept an invitation.
 *  - If an account with the invited email exists, the caller MUST be authenticated as that user
 *    (the prototype allowed takeover here).
 *  - Otherwise a new account is created with the supplied name/password and verified by the invitation itself.
 */
export async function acceptInvitation(rawToken: string, actor: { userId?: string | null; name?: string; password?: string }, meta: { ip?: string | null; userAgent?: string | null }) {
  const inv = await prisma.invitation.findUnique({ where: { tokenHash: sha256(rawToken) }, include: { role: true, workspace: true } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= new Date()) throw Errors.badRequest("This invitation is invalid or has expired");
  const existing = await prisma.user.findUnique({ where: { email: inv.email } });

  return prisma.$transaction(async (tx) => {
    let userId: string;
    let createdUser = false;
    if (existing) {
      if (!actor.userId || actor.userId !== existing.id) throw Errors.forbidden("Please sign in with the invited email address to accept this invitation");
      userId = existing.id;
    } else {
      if (actor.userId) {
        // Signed-in user with a different email cannot claim someone else's invitation.
        throw Errors.forbidden("This invitation was sent to a different email address");
      }
      const { hashPassword, passwordPolicyError } = await import("../auth/password");
      if (!actor.name || !actor.password) throw Errors.badRequest("Name and password are required to create your account");
      const pErr = passwordPolicyError(actor.password);
      if (pErr) throw Errors.badRequest(pErr);
      const u = await tx.user.create({ data: { email: inv.email, name: actor.name.trim(), passwordHash: await hashPassword(actor.password), emailVerifiedAt: new Date(), locale: inv.workspace.defaultLocale } });
      userId = u.id;
      createdUser = true;
    }
    const consumed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null }, data: { acceptedAt: new Date(), acceptedUserId: userId } });
    if (consumed.count === 0) throw Errors.conflict("Invitation already accepted");
    await tx.membership.upsert({
      where: { userId_workspaceId: { userId, workspaceId: inv.workspaceId } },
      update: { roleId: inv.roleId, status: "ACTIVE" },
      create: { userId, workspaceId: inv.workspaceId, roleId: inv.roleId },
    });
    await audit({ workspaceId: inv.workspaceId, actorUserId: userId, action: "member.joined", targetType: "Membership", targetId: userId, ip: meta.ip, userAgent: meta.userAgent, meta: { role: inv.role.key, viaInvitation: inv.id } }, tx);
    return { userId, createdUser, workspaceSlug: inv.workspace.slug };
  });
}

export async function changeMemberRole(ctx: WorkspaceContext, membershipId: string, roleId: string, meta: { ip?: string | null }) {
  const m = await prisma.membership.findFirst({ where: { id: membershipId, workspaceId: ctx.workspace.id }, include: { role: true, user: true } });
  if (!m) throw Errors.notFound("Member");
  assertCanManageMember(ctx, m.role.rank, m.userId);
  const role = await prisma.role.findFirst({ where: { id: roleId, workspaceId: ctx.workspace.id } });
  if (!role) throw Errors.notFound("Role");
  assertCanAssignRole(ctx, { key: role.key, rank: role.rank, permissions: [...(await loadRolePermissions(role.id))] });
  if (m.role.key === "owner") {
    const owners = await prisma.membership.count({ where: { workspaceId: ctx.workspace.id, role: { key: "owner" }, status: "ACTIVE" } });
    if (owners <= 1) throw Errors.conflict("A workspace must keep at least one owner");
  }
  await prisma.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: m.id }, data: { roleId } });
    await queueEmail({ to: m.user.email, templateKey: "account.role_changed", workspaceId: ctx.workspace.id, userId: m.userId, locale: m.user.locale, vars: { name: m.user.name, workspaceName: ctx.workspace.name, roleName: role.name, ctaUrl: appLink(`/app/${ctx.workspace.slug}`) } }, tx);
    await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "member.role_changed", targetType: "Membership", targetId: m.id, ip: meta.ip, meta: { userId: m.userId, from: m.role.key, to: role.key } }, tx);
  });
}

export async function setMemberStatus(ctx: WorkspaceContext, membershipId: string, status: "ACTIVE" | "SUSPENDED", meta: { ip?: string | null }) {
  const m = await prisma.membership.findFirst({ where: { id: membershipId, workspaceId: ctx.workspace.id }, include: { role: true } });
  if (!m) throw Errors.notFound("Member");
  assertCanManageMember(ctx, m.role.rank, m.userId);
  await prisma.membership.update({ where: { id: m.id }, data: { status } });
  await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: status === "SUSPENDED" ? "member.suspended" : "member.restored", targetType: "Membership", targetId: m.id, ip: meta.ip, meta: { userId: m.userId } });
}

export async function removeMember(ctx: WorkspaceContext, membershipId: string, meta: { ip?: string | null }) {
  const m = await prisma.membership.findFirst({ where: { id: membershipId, workspaceId: ctx.workspace.id }, include: { role: true } });
  if (!m) throw Errors.notFound("Member");
  assertCanManageMember(ctx, m.role.rank, m.userId);
  if (m.role.key === "owner") throw Errors.forbidden("Transfer ownership before removing an owner");
  await prisma.$transaction(async (tx) => {
    await tx.membership.delete({ where: { id: m.id } });
    await tx.lead.updateMany({ where: { workspaceId: ctx.workspace.id, assignedToId: m.userId }, data: { assignedToId: null } });
    await tx.conversation.updateMany({ where: { workspaceId: ctx.workspace.id, assignedToId: m.userId }, data: { assignedToId: null } });
    await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "member.removed", targetType: "Membership", targetId: m.id, ip: meta.ip, meta: { userId: m.userId } }, tx);
  });
}
