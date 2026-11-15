import { prisma } from "../db";
import { env } from "../env";
import { audit } from "../audit";
import { AppError, Errors } from "../errors";
import { generateToken, sha256 } from "../crypto";
import { rateLimit } from "../ratelimit";
import { appLink, queueEmail } from "../email/service";
import { DUMMY_HASH, hashPassword, passwordPolicyError, verifyPassword } from "./password";
import { createSession, revokeAllSessions, revokeSession } from "./session";
import { createWorkspace } from "../platform/workspaces";

const RESET_TTL_MIN = 30;
const VERIFY_TTL_MIN = 60 * 24;
const MAX_FAILED = 8;
const LOCK_MIN = 15;

type ReqMeta = { ip?: string | null; userAgent?: string | null };

export async function register(input: { email: string; name: string; password: string; businessName?: string; locale?: string }, meta: ReqMeta) {
  const policy = await prisma.platformSetting.findUnique({ where: { key: "registration" } });
  const reg = (policy?.value as { enabled?: boolean; requireApproval?: boolean; allowedDomains?: string[] } | null) ?? {};
  if (reg.enabled === false) throw Errors.forbidden("Self-service registration is disabled. Please contact us.");
  const email = input.email.trim().toLowerCase();
  if (reg.allowedDomains?.length && !reg.allowedDomains.includes(email.split("@")[1] ?? "")) throw Errors.forbidden("Registration is restricted to approved email domains");
  const pErr = passwordPolicyError(input.password);
  if (pErr) throw Errors.badRequest(pErr);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Do not reveal registration status; behave as if succeeded but notify the existing account.
    await queueEmail({ to: email, templateKey: "auth.new_login", userId: existing.id, locale: existing.locale, vars: { name: existing.name, device: "Registration attempt", ip: meta.ip ?? "unknown", when: new Date().toISOString(), ctaUrl: appLink("/login") } }).catch(() => {});
    return { ok: true, pendingVerification: true };
  }

  const passwordHash = await hashPassword(input.password);
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, name: input.name.trim(), passwordHash, locale: input.locale ?? "en" } });
    const workspace = await createWorkspace(
      { name: input.businessName?.trim() || `${input.name.trim()}'s Business`, ownerUserId: user.id, type: "CUSTOMER", status: reg.requireApproval ? "PENDING" : "ACTIVE", startTrial: true },
      tx,
    );
    const raw = generateToken();
    await tx.emailVerificationToken.create({ data: { userId: user.id, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + VERIFY_TTL_MIN * 60_000) } });
    await queueEmail(
      { to: email, templateKey: "auth.verify_email", userId: user.id, workspaceId: workspace.id, locale: user.locale, vars: { name: user.name, expiresMinutes: VERIFY_TTL_MIN, ctaUrl: appLink(`/verify-email?token=${raw}`) } },
      tx,
    );
    await audit({ workspaceId: workspace.id, actorUserId: user.id, action: "auth.register", targetType: "User", targetId: user.id, ip: meta.ip, userAgent: meta.userAgent }, tx);
    return { user, workspace };
  });
  return { ok: true, pendingVerification: true, workspaceSlug: result.workspace.slug };
}

export async function login(input: { email: string; password: string }, meta: ReqMeta) {
  const email = input.email.trim().toLowerCase();
  const ipLimit = await rateLimit(`login:ip:${meta.ip ?? "unknown"}`, 20, 300);
  const emailLimit = await rateLimit(`login:email:${email}`, 10, 300);
  if (!ipLimit.allowed || !emailLimit.allowed) throw Errors.rateLimited(Math.max(ipLimit.retryAfter, emailLimit.retryAfter));

  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, input.password);
  if (!user || !ok) {
    if (user) {
      const failed = user.failedLoginCount + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MIN * 60_000) : user.lockedUntil },
      });
      await audit({ actorUserId: user.id, action: "auth.login_failed", targetType: "User", targetId: user.id, ip: meta.ip, userAgent: meta.userAgent, meta: { failed } });
    } else {
      await audit({ actorType: "SYSTEM", action: "auth.login_failed", meta: { email }, ip: meta.ip, userAgent: meta.userAgent });
    }
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) throw Errors.forbidden("Account temporarily locked due to failed sign-in attempts. Try again later.");
  if (user.status !== "ACTIVE") throw Errors.forbidden("This account has been suspended. Contact support.");

  const { token, session } = await createSession(user.id, meta);
  const isNewDevice = meta.userAgent && !(await prisma.session.findFirst({ where: { userId: user.id, userAgent: meta.userAgent.slice(0, 300), id: { not: session.id } }, select: { id: true } }));
  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await audit({ actorUserId: user.id, action: "auth.login", targetType: "Session", targetId: session.id, ip: meta.ip, userAgent: meta.userAgent });
  if (isNewDevice && user.lastLoginAt) {
    await queueEmail({ to: user.email, templateKey: "auth.new_login", userId: user.id, locale: user.locale, vars: { name: user.name, device: (meta.userAgent ?? "Unknown").slice(0, 120), ip: meta.ip ?? "unknown", when: new Date().toUTCString(), ctaUrl: appLink("/settings/security") } }).catch(() => {});
  }
  return { token, session, user };
}

export async function logout(sessionId: string, userId: string, meta: ReqMeta) {
  await revokeSession(sessionId, "logout");
  await audit({ actorUserId: userId, action: "auth.logout", targetType: "Session", targetId: sessionId, ip: meta.ip, userAgent: meta.userAgent });
}

export async function requestPasswordReset(emailRaw: string, meta: ReqMeta) {
  const email = emailRaw.trim().toLowerCase();
  const r = await rateLimit(`pwreset:${meta.ip ?? "unknown"}`, 5, 900);
  if (!r.allowed) throw Errors.rateLimited(r.retryAfter);
  const user = await prisma.user.findUnique({ where: { email } });
  // Always respond identically — never reveal whether the email is registered.
  if (!user || user.status !== "ACTIVE") {
    await audit({ actorType: "SYSTEM", action: "auth.password_reset_requested_unknown", ip: meta.ip, meta: { email } });
    return;
  }
  const perUser = await rateLimit(`pwreset:user:${user.id}`, 3, 3600);
  if (!perUser.allowed) return;
  const raw = generateToken();
  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }); // invalidate earlier tokens
    await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60_000), requestedIp: meta.ip ?? null } });
    await queueEmail({ to: user.email, templateKey: "auth.forgot_password", userId: user.id, locale: user.locale, vars: { name: user.name, expiresMinutes: RESET_TTL_MIN, ctaUrl: appLink(`/reset-password?token=${raw}`) } }, tx);
    await audit({ actorUserId: user.id, action: "auth.password_reset_requested", targetType: "User", targetId: user.id, ip: meta.ip, userAgent: meta.userAgent }, tx);
  });
}

export async function resetPassword(rawToken: string, newPassword: string, meta: ReqMeta) {
  const pErr = passwordPolicyError(newPassword);
  if (pErr) throw Errors.badRequest(pErr);
  const token = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(rawToken) }, include: { user: true } });
  if (!token || token.usedAt || token.expiresAt <= new Date()) throw Errors.badRequest("This reset link is invalid or has expired. Please request a new one.");
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    // One-time use: conditional update guards against concurrent submissions.
    const consumed = await tx.passwordResetToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
    if (consumed.count === 0) throw Errors.badRequest("This reset link has already been used.");
    await tx.user.update({ where: { id: token.userId }, data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null, emailVerifiedAt: token.user.emailVerifiedAt ?? new Date() } });
    await tx.session.updateMany({ where: { userId: token.userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "password_reset" } });
    await queueEmail({ to: token.user.email, templateKey: "auth.password_changed", userId: token.userId, locale: token.user.locale, vars: { name: token.user.name, when: new Date().toUTCString(), ctaUrl: appLink("/settings/security") } }, tx);
    await audit({ actorUserId: token.userId, action: "auth.password_reset_completed", targetType: "User", targetId: token.userId, ip: meta.ip, userAgent: meta.userAgent }, tx);
  });
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string, keepSessionId: string, meta: ReqMeta) {
  const pErr = passwordPolicyError(newPassword);
  if (pErr) throw Errors.badRequest(pErr);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(user.passwordHash, currentPassword))) throw Errors.badRequest("Current password is incorrect");
  const passwordHash = await hashPassword(newPassword);
  const changedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: changedAt } });
    // Keep the current session alive by re-dating it after the password change marker.
    await tx.session.update({ where: { id: keepSessionId }, data: { createdAt: new Date(changedAt.getTime() + 1) } });
    await tx.session.updateMany({ where: { userId, revokedAt: null, id: { not: keepSessionId } }, data: { revokedAt: new Date(), revokeReason: "password_change" } });
    await queueEmail({ to: user.email, templateKey: "auth.password_changed", userId, locale: user.locale, vars: { name: user.name, when: changedAt.toUTCString(), ctaUrl: appLink("/settings/security") } }, tx);
    await audit({ actorUserId: userId, action: "auth.password_changed", targetType: "User", targetId: userId, ip: meta.ip, userAgent: meta.userAgent }, tx);
  });
}

export async function verifyEmail(rawToken: string) {
  const token = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: sha256(rawToken) }, include: { user: true } });
  if (!token || token.usedAt || token.expiresAt <= new Date()) throw Errors.badRequest("This verification link is invalid or has expired.");
  await prisma.$transaction(async (tx) => {
    const consumed = await tx.emailVerificationToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
    if (consumed.count === 0) throw Errors.badRequest("This verification link has already been used.");
    const wasVerified = Boolean(token.user.emailVerifiedAt);
    await tx.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: token.user.emailVerifiedAt ?? new Date() } });
    if (!wasVerified) {
      await queueEmail({ to: token.user.email, templateKey: "auth.welcome", userId: token.userId, locale: token.user.locale, vars: { name: token.user.name, ctaUrl: appLink("/app") } }, tx);
    }
    await audit({ actorUserId: token.userId, action: "auth.email_verified", targetType: "User", targetId: token.userId }, tx);
  });
}

export async function resendVerification(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt) return;
  const r = await rateLimit(`verify:resend:${userId}`, 3, 3600);
  if (!r.allowed) throw Errors.rateLimited(r.retryAfter);
  const raw = generateToken();
  await prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
    await tx.emailVerificationToken.create({ data: { userId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + VERIFY_TTL_MIN * 60_000) } });
    await queueEmail({ to: user.email, templateKey: "auth.verify_email", userId, locale: user.locale, vars: { name: user.name, expiresMinutes: VERIFY_TTL_MIN, ctaUrl: appLink(`/verify-email?token=${raw}`) } }, tx);
  });
}

export async function revokeOtherSessions(userId: string, keepSessionId: string, meta: ReqMeta) {
  const count = await revokeAllSessions(userId, "user_revoked", keepSessionId);
  await audit({ actorUserId: userId, action: "auth.sessions_revoked", targetType: "User", targetId: userId, ip: meta.ip, meta: { count } });
  return count;
}

export const authConfig = { RESET_TTL_MIN, VERIFY_TTL_MIN, sessionTtlHours: () => env().SESSION_TTL_HOURS };
