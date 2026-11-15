import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { call, lastEmail, makeUser, makeWorkspace, resetDb, sessionFor } from "../helpers";
import { GET as membersGet, POST as membersPost, PATCH as membersPatch } from "@/app/api/v1/team/members/route";
import { GET as rolesGet, POST as rolesPost } from "@/app/api/v1/team/roles/route";
import { GET as invitePreview, POST as inviteAccept } from "@/app/api/v1/invitations/route";
import { decryptJson } from "@/server/crypto";
import { _resetMemoryLimiter } from "@/server/ratelimit";

describe("tenant isolation & team management", () => {
  let ownerA: Awaited<ReturnType<typeof makeUser>>;
  let ownerB: Awaited<ReturnType<typeof makeUser>>;
  let wsA: Awaited<ReturnType<typeof makeWorkspace>>;
  let wsB: Awaited<ReturnType<typeof makeWorkspace>>;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    await resetDb();
    _resetMemoryLimiter();
    ownerA = await makeUser("a@example.com");
    ownerB = await makeUser("b@example.com");
    wsA = await makeWorkspace("Alpha Co", ownerA.id);
    wsB = await makeWorkspace("Beta Co", ownerB.id);
    tokenA = await sessionFor(ownerA.id);
    tokenB = await sessionFor(ownerB.id);
  });

  it("owner can list own members; other tenant gets 404 (existence hidden)", async () => {
    const mine = await call(membersGet, { token: tokenA, workspace: wsA.slug });
    expect(mine.status).toBe(200);
    expect((mine.json.members as unknown[]).length).toBe(1);
    const theirs = await call(membersGet, { token: tokenB, workspace: wsA.slug });
    expect(theirs.status).toBe(404);
    const byId = await call(membersGet, { token: tokenB, workspace: wsA.id });
    expect(byId.status).toBe(404);
  });

  it("invitation: existing user must sign in as the invited account (no takeover)", async () => {
    const roles = await call(rolesGet, { token: tokenA, workspace: wsA.slug });
    const moderator = (roles.json.roles as { key: string; id: string }[]).find((r) => r.key === "moderator")!;
    const invited = await makeUser("mod@example.com");
    const r = await call(membersPost, { token: tokenA, workspace: wsA.slug, body: { email: invited.email, roleId: moderator.id } });
    expect(r.status).toBe(200);
    const mail = await lastEmail("account.invitation");
    const raw = new URL(decryptJson<{ ctaUrl: string }>(mail!.varsEnc!).ctaUrl).searchParams.get("token")!;

    const preview = await call(invitePreview, { url: `/api/v1/invitations?token=${raw}` });
    expect(preview.json.accountExists).toBe(true);

    // Anonymous attempt to claim with a new password → forbidden
    const anon = await call(inviteAccept, { body: { token: raw, name: "Attacker", password: "Attacker-Pass-1" } });
    expect(anon.status).toBe(403);
    // Signed-in as a different user → forbidden
    const wrong = await call(inviteAccept, { token: tokenB, body: { token: raw } });
    expect(wrong.status).toBe(403);
    // Correct user → joins
    const ok = await call(inviteAccept, { token: await sessionFor(invited.id), body: { token: raw } });
    expect(ok.status).toBe(200);
    const m = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: invited.id, workspaceId: wsA.id } }, include: { role: true } });
    expect(m?.role.key).toBe("moderator");
    // one-time
    const again = await call(inviteAccept, { token: await sessionFor(invited.id), body: { token: raw } });
    expect(again.status).toBe(400);
  });

  it("invitation for a new email creates the account and signs it in", async () => {
    const roles = await call(rolesGet, { token: tokenA, workspace: wsA.slug });
    const viewer = (roles.json.roles as { key: string; id: string }[]).find((r) => r.key === "viewer")!;
    await call(membersPost, { token: tokenA, workspace: wsA.slug, body: { email: "newbie@example.com", roleId: viewer.id } });
    const mail = await lastEmail("account.invitation");
    const raw = new URL(decryptJson<{ ctaUrl: string }>(mail!.varsEnc!).ctaUrl).searchParams.get("token")!;
    const r = await call(inviteAccept, { body: { token: raw, name: "Newbie", password: "Newbie-Pass-123" } });
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toContain("pm_session=");
    const u = await prisma.user.findUnique({ where: { email: "newbie@example.com" } });
    expect(u?.emailVerifiedAt).toBeTruthy();
  });

  it("prevents privilege escalation: moderator cannot manage team; manager cannot grant billing", async () => {
    const mod = await prisma.user.findUnique({ where: { email: "mod@example.com" } });
    const modToken = await sessionFor(mod!.id);
    const denied = await call(membersGet, { token: modToken, workspace: wsA.slug });
    expect(denied.status).toBe(403);

    // Create a custom role with team.manage but without billing.manage, assign to a user, then try to escalate.
    const custom = await call(rolesPost, { token: tokenA, workspace: wsA.slug, body: { name: "Team Lead", permissions: ["dashboard.view", "team.manage", "comments.read"] } });
    expect(custom.status).toBe(200);
    const lead = await makeUser("lead@example.com");
    await prisma.membership.create({ data: { userId: lead.id, workspaceId: wsA.id, roleId: (custom.json.role as { id: string }).id } });
    const leadToken = await sessionFor(lead.id);
    const escalate = await call(rolesPost, { token: leadToken, workspace: wsA.slug, body: { name: "Sneaky", permissions: ["billing.manage", "team.manage"] } });
    expect(escalate.status).toBe(403);
    const roles = await call(rolesGet, { token: leadToken, workspace: wsA.slug });
    const ownerRole = (roles.json.roles as { key: string; id: string }[]).find((r) => r.key === "owner")!;
    const modMembership = await prisma.membership.findFirst({ where: { userId: mod!.id, workspaceId: wsA.id } });
    const promote = await call(membersPatch, { token: leadToken, workspace: wsA.slug, body: { membershipId: modMembership!.id, roleId: ownerRole.id } });
    expect(promote.status).toBe(403);
    // Role change by the real owner is logged
    const managerRole = (roles.json.roles as { key: string; id: string }[]).find((r) => r.key === "manager")!;
    const ok = await call(membersPatch, { token: tokenA, workspace: wsA.slug, body: { membershipId: modMembership!.id, roleId: managerRole.id } });
    expect(ok.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { workspaceId: wsA.id, action: "member.role_changed" } })).toBe(1);
  });

  it("super admin gets read-only oversight but no inbox access without a grant", async () => {
    const admin = await makeUser("root@example.com", { platformRole: "SUPER_ADMIN" });
    const { resolveWorkspaceContext } = await import("@/server/rbac/guard");
    const ctx = await resolveWorkspaceContext(admin, wsA.slug);
    expect(ctx.viaPlatform).toBe(true);
    expect(ctx.permissions.has("comments.read")).toBe(true);
    expect(ctx.permissions.has("inbox.manage")).toBe(false);
    expect(ctx.permissions.has("team.manage")).toBe(false);
    await prisma.supportAccessGrant.create({ data: { workspaceId: wsA.id, requestedById: admin.id, reason: "ticket #1", status: "APPROVED", approvedById: ownerA.id, approvedAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) } });
    const ctx2 = await resolveWorkspaceContext(admin, wsA.slug);
    expect(ctx2.permissions.has("inbox.manage")).toBe(true);
  });

  it("suspended workspace loses operational permissions", async () => {
    await prisma.workspace.update({ where: { id: wsB.id }, data: { status: "SUSPENDED" } });
    const r = await call(membersGet, { token: tokenB, workspace: wsB.slug });
    expect(r.status).toBe(403);
    await prisma.workspace.update({ where: { id: wsB.id }, data: { status: "ACTIVE" } });
  });
});
