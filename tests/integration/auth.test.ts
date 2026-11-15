import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { call, lastEmail, makeUser, resetDb, sessionFor } from "../helpers";
import { POST as registerRoute } from "@/app/api/v1/auth/register/route";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { POST as logoutRoute } from "@/app/api/v1/auth/logout/route";
import { POST as forgotRoute } from "@/app/api/v1/auth/forgot-password/route";
import { POST as resetRoute } from "@/app/api/v1/auth/reset-password/route";
import { POST as verifyRoute } from "@/app/api/v1/auth/verify-email/route";
import { POST as changePwRoute } from "@/app/api/v1/auth/change-password/route";
import { GET as meRoute } from "@/app/api/v1/auth/me/route";
import { decryptJson } from "@/server/crypto";
import { _resetMemoryLimiter } from "@/server/ratelimit";

function tokenFromEmail(varsEnc: string | null, param: string) {
  const vars = decryptJson<{ ctaUrl: string }>(varsEnc!);
  return new URL(vars.ctaUrl).searchParams.get(param)!;
}

describe("authentication", () => {
  beforeAll(async () => {
    await resetDb();
    _resetMemoryLimiter();
  });

  it("registers, creates a workspace, sends verification and logs in", async () => {
    const r = await call(registerRoute, { body: { name: "Jamil", email: "jamil@example.com", password: "Strong-Pass-123", businessName: "Coastal Test" } });
    expect(r.status).toBe(200);
    const user = await prisma.user.findUnique({ where: { email: "jamil@example.com" }, include: { memberships: { include: { role: true, workspace: true } } } });
    expect(user?.memberships[0].role.key).toBe("owner");
    expect(user?.memberships[0].workspace.name).toBe("Coastal Test");
    const sub = await prisma.subscription.findUnique({ where: { workspaceId: user!.memberships[0].workspaceId } });
    expect(sub?.status).toBe("TRIALING");

    const mail = await lastEmail("auth.verify_email");
    expect(mail?.toEmail).toBe("jamil@example.com");
    const v = await call(verifyRoute, { body: { token: tokenFromEmail(mail!.varsEnc, "token") } });
    expect(v.status).toBe(200);
    // one-time
    const v2 = await call(verifyRoute, { body: { token: tokenFromEmail(mail!.varsEnc, "token") } });
    expect(v2.status).toBe(400);

    const login = await call(loginRoute, { body: { email: "JAMIL@example.com", password: "Strong-Pass-123" } });
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).toContain("pm_session=");
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("does not reveal duplicate registrations", async () => {
    const r = await call(registerRoute, { body: { name: "Other", email: "jamil@example.com", password: "Strong-Pass-999" } });
    expect(r.status).toBe(200);
    expect(await prisma.user.count({ where: { email: "jamil@example.com" } })).toBe(1);
  });

  it("rejects wrong passwords and locks after repeated failures", async () => {
    const u = await makeUser("lock@example.com");
    for (let i = 0; i < 8; i++) {
      const r = await call(loginRoute, { body: { email: u.email, password: "wrong-password-1" } });
      expect(r.status).toBe(401);
    }
    const locked = await call(loginRoute, { body: { email: u.email, password: "Password-12345" } });
    expect(locked.status).toBe(403);
    expect(await prisma.auditLog.count({ where: { action: "auth.login_failed", actorUserId: u.id } })).toBe(8);
  });

  it("CSRF: mutating request without matching Origin is blocked", async () => {
    const u = await makeUser("csrf@example.com");
    const token = await sessionFor(u.id);
    const r = await call(logoutRoute, { token, method: "POST", headers: { origin: "https://evil.example" } });
    expect(r.status).toBe(403);
  });

  it("password reset: identical response for unknown email, one-time token, session revocation, notification", async () => {
    const u = await makeUser("reset@example.com");
    const oldToken = await sessionFor(u.id);
    const unknown = await call(forgotRoute, { body: { email: "nobody@example.com" } });
    const known = await call(forgotRoute, { body: { email: u.email } });
    expect(unknown.status).toBe(200);
    expect(JSON.stringify(unknown.json)).toBe(JSON.stringify(known.json));
    expect(await prisma.emailDelivery.count({ where: { toEmail: "nobody@example.com" } })).toBe(0);

    const mail = await lastEmail("auth.forgot_password");
    const raw = tokenFromEmail(mail!.varsEnc, "token");
    const stored = await prisma.passwordResetToken.findFirst({ where: { userId: u.id } });
    expect(stored?.tokenHash).not.toBe(raw); // only hash stored
    expect(stored!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000 + 2000);

    const bad = await call(resetRoute, { body: { token: raw, password: "short" } });
    expect(bad.status).toBe(422); // schema validation
    const weak = await call(resetRoute, { body: { token: raw, password: "onlyletterslong" } });
    expect(weak.status).toBe(400); // policy: needs digits
    const ok = await call(resetRoute, { body: { token: raw, password: "New-Password-456" } });
    expect(ok.status).toBe(200);
    const again = await call(resetRoute, { body: { token: raw, password: "New-Password-789" } });
    expect(again.status).toBe(400);

    // old session revoked
    const me = await call(meRoute, { token: oldToken });
    expect(me.status).toBe(401);
    const login = await call(loginRoute, { body: { email: u.email, password: "New-Password-456" } });
    expect(login.status).toBe(200);
    expect(await lastEmail("auth.password_changed")).toBeTruthy();
    expect(await prisma.auditLog.count({ where: { action: "auth.password_reset_completed", actorUserId: u.id } })).toBe(1);
  });

  it("change password keeps the current session and revokes the others", async () => {
    const u = await makeUser("change@example.com");
    const keep = await sessionFor(u.id);
    const other = await sessionFor(u.id);
    const r = await call(changePwRoute, { token: keep, body: { currentPassword: "Password-12345", newPassword: "Another-Pass-321" } });
    expect(r.status).toBe(200);
    expect((await call(meRoute, { token: keep })).status).toBe(200);
    expect((await call(meRoute, { token: other })).status).toBe(401);
  });

  it("suspended users cannot use existing sessions", async () => {
    const u = await makeUser("susp@example.com");
    const token = await sessionFor(u.id);
    await prisma.user.update({ where: { id: u.id }, data: { status: "SUSPENDED" } });
    expect((await call(meRoute, { token })).status).toBe(401);
  });
});
