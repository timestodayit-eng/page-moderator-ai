import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { call, lastEmail, makeUser, makeWorkspace, resetDb, sessionFor } from "../helpers";
import { installMocks, mock, resetMocks } from "../mocks";
import { resetEnvCache } from "@/server/env";
import { GET as overviewRoute } from "@/app/api/v1/platform/overview/route";
import { GET as wsList, POST as wsCreate } from "@/app/api/v1/platform/workspaces/route";
import { POST as wsStatus } from "@/app/api/v1/platform/workspaces/[id]/status/route";
import { POST as wsSub } from "@/app/api/v1/platform/workspaces/[id]/subscription/route";
import { GET as usersList } from "@/app/api/v1/platform/users/route";
import { PATCH as userPatch } from "@/app/api/v1/platform/users/[id]/route";
import { DELETE as userSessions } from "@/app/api/v1/platform/users/[id]/sessions/route";
import { POST as userReset } from "@/app/api/v1/platform/users/[id]/password-reset/route";
import { POST as planUpsert } from "@/app/api/v1/platform/plans/route";
import { PUT as settingsPut } from "@/app/api/v1/platform/settings/route";
import { GET as auditList } from "@/app/api/v1/platform/audit-logs/route";
import { POST as campaignPost } from "@/app/api/v1/platform/email/campaigns/route";
import { POST as testEmail } from "@/app/api/v1/platform/email/test/route";
import { POST as supportReq } from "@/app/api/v1/platform/workspaces/[id]/support-access/route";
import { POST as supportDecide } from "@/app/api/v1/settings/security/support-access/route";
import { GET as subGet } from "@/app/api/v1/subscriptions/route";
import { POST as changePlanRoute } from "@/app/api/v1/subscriptions/change/route";
import { POST as manualPay } from "@/app/api/v1/invoices/[id]/manual-payment/route";
import { POST as billingWebhook } from "@/app/api/webhooks/billing/[provider]/route";
import { GET as meRoute } from "@/app/api/v1/auth/me/route";
import { complete, AiError } from "@/server/ai/gateway";
import { runBillingCycle } from "@/server/billing/lifecycle";
import { hmacSha256Hex } from "@/server/crypto";
import { processBillingWebhookEvent } from "@/server/billing/providers";

describe("Super Admin, billing & AI budgets", () => {
  let admin: Awaited<ReturnType<typeof makeUser>>;
  let adminToken: string;
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let ownerToken: string;
  let ws: Awaited<ReturnType<typeof makeWorkspace>>;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = "sk-test-platform-key-123456789";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret_value_1234";
    resetEnvCache();
    installMocks();
    await resetDb();
    admin = await makeUser("root@example.com", { platformRole: "SUPER_ADMIN" });
    adminToken = await sessionFor(admin.id);
    owner = await makeUser("owner@example.com");
    ownerToken = await sessionFor(owner.id);
    ws = await makeWorkspace("Customer Co", owner.id);
  });
  beforeEach(() => resetMocks());

  it("platform routes are forbidden for normal users and work for super admin", async () => {
    expect((await call(overviewRoute, { token: ownerToken })).status).toBe(403);
    const r = await call(overviewRoute, { token: adminToken });
    expect(r.status).toBe(200);
    expect((r.json.businesses as { total: number }).total).toBe(1);
  });

  it("admin creates a business account: owner gets a setup email and workspace with trial", async () => {
    const r = await call(wsCreate, { token: adminToken, body: { name: "New Biz", ownerEmail: "newowner@example.com", ownerName: "New Owner", type: "CUSTOMER", planKey: "starter" } });
    expect(r.status).toBe(200);
    const mail = await lastEmail("account.created");
    expect(mail?.toEmail).toBe("newowner@example.com");
    const u = await prisma.user.findUnique({ where: { email: "newowner@example.com" }, include: { passwordResetTokens: true } });
    expect(u?.passwordResetTokens).toHaveLength(1);
    const list = await call(wsList, { token: adminToken, url: "/x?search=new biz" });
    expect(list.json.total).toBe(1);
  });

  it("suspend cancels pending actions, pauses automation, emails owner; reactivation restores", async () => {
    await prisma.outboundAction.create({ data: { workspaceId: ws.id, type: "HIDE_COMMENT", targetId: "c", idempotencyKey: "pending-1" } });
    const r = await call(wsStatus, { token: adminToken, params: { id: ws.id }, body: { status: "SUSPENDED", reason: "non-payment" } });
    expect(r.status).toBe(200);
    const w = await prisma.workspace.findUnique({ where: { id: ws.id } });
    expect(w?.status).toBe("SUSPENDED");
    expect(w?.emergencyPause).toBe(true);
    expect((await prisma.outboundAction.findFirst({ where: { idempotencyKey: "pending-1" } }))?.status).toBe("CANCELLED");
    expect((await lastEmail("account.suspended"))?.toEmail).toBe("owner@example.com");
    // owner can still see billing but not operate
    const { resolveWorkspaceContext } = await import("@/server/rbac/guard");
    const ctx = await resolveWorkspaceContext(owner, ws.slug);
    expect(ctx.permissions.has("billing.view")).toBe(true);
    expect(ctx.permissions.has("comments.hide")).toBe(false);
    await call(wsStatus, { token: adminToken, params: { id: ws.id }, body: { status: "ACTIVE", reason: "paid" } });
    expect((await prisma.workspace.findUnique({ where: { id: ws.id } }))?.emergencyPause).toBe(false);
  });

  it("user management: suspend revokes sessions, password reset is triggered, privileged changes audited", async () => {
    const victim = await makeUser("victim@example.com");
    const vt = await sessionFor(victim.id);
    const r = await call(userPatch, { token: adminToken, method: "PATCH", params: { id: victim.id }, body: { status: "SUSPENDED" } });
    expect(r.status).toBe(200);
    expect((await call(meRoute, { token: vt })).status).toBe(401);
    await call(userPatch, { token: adminToken, method: "PATCH", params: { id: victim.id }, body: { status: "ACTIVE", platformRole: "SUPPORT" } });
    expect(await prisma.auditLog.count({ where: { action: "platform.privileged_access_changed", targetId: victim.id } })).toBe(1);
    const self = await call(userPatch, { token: adminToken, method: "PATCH", params: { id: admin.id }, body: { status: "SUSPENDED" } });
    expect(self.status).toBe(403);
    const vt2 = await sessionFor(victim.id);
    await call(userSessions, { token: adminToken, method: "DELETE", params: { id: victim.id } });
    expect((await call(meRoute, { token: vt2 })).status).toBe(401);
    await call(userReset, { token: adminToken, params: { id: victim.id } });
    expect((await lastEmail("auth.forgot_password"))?.toEmail).toBe("victim@example.com");
    const list = await call(usersList, { token: adminToken, url: "/x?search=victim" });
    expect(list.json.total).toBe(1);
  });

  it("plans & subscriptions: edit plan, assign plan, extend trial, override limits (emails sent)", async () => {
    const p = await call(planUpsert, { token: adminToken, body: { key: "starter", name: "Starter", priceMonthlyCents: 1900, priceYearlyCents: 19000, trialDays: 7, limits: { pages: 2, users: 3, agents: 2, commentsPerMonth: 3000, aiRequestsPerMonth: 4000, aiBudgetMicroUsd: 5000000, autoRepliesPerMonth: 500, storageMb: 200 }, features: ["x"], isPublic: true, isActive: true, id: (await prisma.plan.findUnique({ where: { key: "starter" } }))!.id } });
    expect(p.status).toBe(200);
    const r = await call(wsSub, { token: adminToken, params: { id: ws.id }, body: { planKey: "business", trialExtendDays: 10, limitOverrides: { pages: 50 }, discountPercent: 20 } });
    expect(r.status).toBe(200);
    const sub = await prisma.subscription.findUnique({ where: { workspaceId: ws.id }, include: { plan: true } });
    expect(sub?.plan.key).toBe("business");
    expect(sub?.status).toBe("TRIALING");
    expect((sub?.limitOverrides as { pages: number }).pages).toBe(50);
    expect((await lastEmail("subscription.changed"))?.toEmail).toBe("owner@example.com");
    const { getEffectiveLimits } = await import("@/server/billing/usage");
    expect((await getEffectiveLimits(ws.id)).pages).toBe(50);
  });

  it("settings and audit log", async () => {
    const r = await call(settingsPut, { token: adminToken, method: "PUT", body: { key: "registration", value: { enabled: false } } });
    expect(r.status).toBe(200);
    const { POST: registerRoute } = await import("@/app/api/v1/auth/register/route");
    const reg = await call(registerRoute, { body: { name: "X Y", email: "blocked@example.com", password: "Strong-Pass-123" } });
    expect(reg.status).toBe(403);
    await call(settingsPut, { token: adminToken, method: "PUT", body: { key: "registration", value: { enabled: true } } });
    const logs = await call(auditList, { token: adminToken, url: "/x?action=platform.setting" });
    expect(logs.json.total).toBe(2);
  });

  it("email center: preview, test send (fails cleanly without provider), campaign to owners", async () => {
    const preview = await call(testEmail, { token: adminToken, body: { templateKey: "platform.notice", locale: "bn", vars: { subject: "নোটিশ", message: "আগামীকাল মেইনটেন্যান্স" }, preview: true } });
    expect(preview.status).toBe(200);
    expect(String(preview.json.html)).toContain("আগামীকাল মেইনটেন্যান্স");
    expect(String(preview.json.html)).toContain("Hind Siliguri");
    const sent = await call(testEmail, { token: adminToken, body: { to: "me@example.com", templateKey: "platform.notice", vars: { subject: "Hi", message: "Test" } } });
    expect((sent.json.delivery as { status: string }).status).toBe("FAILED"); // EMAIL_PROVIDER=disabled in tests
    const prev = await call(campaignPost, { token: adminToken, body: { name: "Notice", templateKey: "platform.notice", recipientFilter: { allOwners: true }, vars: { subject: "S", message: "M" }, previewOnly: true } });
    expect(prev.json.recipients).toBe(2);
    const camp = await call(campaignPost, { token: adminToken, body: { name: "Notice", templateKey: "platform.notice", recipientFilter: { allOwners: true }, vars: { subject: "S", message: "M" }, sendNow: true } });
    expect(camp.json.recipients).toBe(2);
    expect(await prisma.emailDelivery.count({ where: { campaignId: (camp.json.campaign as { id: string }).id } })).toBe(2);
  });

  it("support access to private messages requires owner approval and is time-boxed", async () => {
    const req = await call(supportReq, { token: adminToken, params: { id: ws.id }, body: { reason: "Investigating ticket #42", scope: "inbox:read" } });
    expect(req.status).toBe(200);
    const { resolveWorkspaceContext } = await import("@/server/rbac/guard");
    expect((await resolveWorkspaceContext(admin, ws.slug)).permissions.has("inbox.manage")).toBe(false);
    expect(await prisma.notification.count({ where: { userId: owner.id, type: "SUPPORT_ACCESS_REQUEST" } })).toBe(1);
    const grantId = (req.json.grant as { id: string }).id;
    const dec = await call(supportDecide, { token: ownerToken, workspace: ws.slug, body: { grantId, approve: true, hours: 2 } });
    expect(dec.status).toBe(200);
    expect((await resolveWorkspaceContext(admin, ws.slug)).permissions.has("inbox.manage")).toBe(true);
    await prisma.supportAccessGrant.update({ where: { id: grantId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await resolveWorkspaceContext(admin, ws.slug)).permissions.has("inbox.manage")).toBe(false);
  });

  it("AI quota: concurrent requests cannot overspend the monthly budget; BYOK failure never falls back silently", async () => {
    await prisma.subscription.update({ where: { workspaceId: ws.id }, data: { limitOverrides: { aiRequestsPerMonth: 3, aiBudgetMicroUsd: 100_000_000 } } });
    const run = () => complete({ workspaceId: ws.id, purpose: "TEST", messages: [{ role: "user", content: "hi" }] }).then(() => "ok").catch((e: AiError) => e.code);
    const results = await Promise.all([run(), run(), run(), run(), run(), run()]);
    expect(results.filter((r) => r === "ok")).toHaveLength(3);
    expect(results.filter((r) => r === "BUDGET")).toHaveLength(3);
    expect(mock.aiCalls).toBe(3);
    const counter = await prisma.usageCounter.findFirst({ where: { workspaceId: ws.id, metric: "AI_REQUEST" } });
    expect(Number(counter?.value)).toBe(3);
    expect(Number(counter?.reserved)).toBe(0);
    expect(await prisma.aiUsage.count({ where: { workspaceId: ws.id, success: false, errorCode: "AI_REQUEST_LIMIT" } })).toBe(3);

    await prisma.subscription.update({ where: { workspaceId: ws.id }, data: { limitOverrides: {} } });
    await prisma.workspace.update({ where: { id: ws.id }, data: { aiCredentialMode: "BYOK" } });
    const noKey = await run();
    expect(noKey).toBe("NOT_CONFIGURED");
    expect(mock.aiCalls).toBe(3); // no platform call was made
    await prisma.workspace.update({ where: { id: ws.id }, data: { allowPlatformFallback: true } });
    expect(await run()).toBe("ok");
    await prisma.workspace.update({ where: { id: ws.id }, data: { aiCredentialMode: "PLATFORM", allowPlatformFallback: false } });
  });

  it("billing lifecycle: trial end → invoice + grace; manual payment activates; stripe webhook is verified & idempotent", async () => {
    await prisma.subscription.update({ where: { workspaceId: ws.id }, data: { status: "TRIALING", trialEndsAt: new Date(Date.now() - 1000), currentPeriodEnd: new Date(Date.now() - 1000) } });
    const cycle = await runBillingCycle();
    expect(cycle.trialEnded).toBe(1);
    const inv = await prisma.invoice.findFirst({ where: { workspaceId: ws.id, status: "OPEN" } });
    expect(inv).toBeTruthy();
    expect((await prisma.subscription.findUnique({ where: { workspaceId: ws.id } }))?.status).toBe("GRACE");
    expect((await lastEmail("billing.invoice"))?.toEmail).toBe("owner@example.com");

    // owner view
    const view = await call(subGet, { token: ownerToken, workspace: ws.slug });
    expect(view.json.openInvoices).toBe(1);
    // owner cannot record payments (platform only)
    const denied = await call(manualPay, { token: ownerToken, params: { id: inv!.id }, body: { amountCents: inv!.totalCents, reference: "BKASH123" } });
    expect(denied.status).toBe(403);
    const paid = await call(manualPay, { token: adminToken, params: { id: inv!.id }, body: { amountCents: inv!.totalCents, reference: "BKASH123" } });
    expect(paid.status).toBe(200);
    const again = await call(manualPay, { token: adminToken, params: { id: inv!.id }, body: { amountCents: inv!.totalCents, reference: "BKASH123" } });
    expect(again.status).toBe(409); // invoice no longer open
    const sub = await prisma.subscription.findUnique({ where: { workspaceId: ws.id } });
    expect(sub?.status).toBe("ACTIVE");
    expect(sub!.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now() + 25 * 86_400_000);
    expect((await lastEmail("billing.payment_received"))?.toEmail).toBe("owner@example.com");

    // Stripe webhook
    const inv2 = await prisma.invoice.create({ data: { workspaceId: ws.id, subscriptionId: sub!.id, number: "INV-TEST-2", subtotalCents: 7900, totalCents: 7900, dueAt: new Date(), periodStart: new Date(), periodEnd: new Date(Date.now() + 30 * 86_400_000) } });
    const event = { id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1", payment_intent: "pi_1", payment_status: "paid", amount_total: 7900, currency: "usd", metadata: { invoiceId: inv2.id } } } };
    const body = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000);
    const badSig = await call(billingWebhook, { method: "POST", rawBody: body, params: { provider: "stripe" }, headers: { "stripe-signature": `t=${t},v1=bad` } });
    expect(badSig.status).toBe(403);
    const sig = `t=${t},v1=${hmacSha256Hex("whsec_test_secret_value_1234", `${t}.${body}`)}`;
    const ok = await call(billingWebhook, { method: "POST", rawBody: body, params: { provider: "stripe" }, headers: { "stripe-signature": sig } });
    expect(ok.status).toBe(200);
    const dup = await call(billingWebhook, { method: "POST", rawBody: body, params: { provider: "stripe" }, headers: { "stripe-signature": sig } });
    expect(dup.json.duplicate).toBe(true);
    const ev = await prisma.webhookEvent.findFirst({ where: { dedupeKey: "stripe:evt_1" } });
    await processBillingWebhookEvent(ev!.id);
    await processBillingWebhookEvent(ev!.id);
    expect((await prisma.invoice.findUnique({ where: { id: inv2.id } }))?.status).toBe("PAID");
    expect(await prisma.payment.count({ where: { providerPaymentId: "pi_1" } })).toBe(1);

    // self-service plan change: upgrade creates an invoice immediately
    const ch = await call(changePlanRoute, { token: ownerToken, workspace: ws.slug, body: { planKey: "business", interval: "YEARLY" } });
    expect(ch.status).toBe(200);
    expect(ch.json.immediate).toBe(true);
  });

  it("internal (billing-exempt) workspaces keep usage records and limits but never get invoices", async () => {
    const internal = await makeWorkspace("Coastal Manpower", admin.id, "INTERNAL");
    const sub = await prisma.subscription.findUnique({ where: { workspaceId: internal.id }, include: { plan: true } });
    expect(sub?.status).toBe("EXEMPT");
    expect(sub?.plan.key).toBe("enterprise");
    const { createRenewalInvoice } = await import("@/server/billing/lifecycle");
    expect(await createRenewalInvoice(internal.id)).toBeNull();
    const { recordUsage, getEffectiveLimits } = await import("@/server/billing/usage");
    await recordUsage(internal.id, "COMMENTS_PROCESSED", 5);
    expect((await getEffectiveLimits(internal.id)).serviceActive).toBe(true);
  });
});
