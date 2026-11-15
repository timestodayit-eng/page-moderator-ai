import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { call, makeUser, makeWorkspace, resetDb, sessionFor } from "../helpers";
import { installMocks, mock, resetMocks } from "../mocks";
import { encrypt, hmacSha256Hex } from "@/server/crypto";
import { GET as webhookGet, POST as webhookPost } from "@/app/api/webhooks/meta/route";
import { POST as disconnectRoute } from "@/app/api/v1/pages/[id]/disconnect/route";
import { PATCH as configRoute } from "@/app/api/v1/pages/[id]/config/route";
import { POST as reviewRoute } from "@/app/api/v1/moderation/decisions/[id]/route";
import { POST as unhideRoute } from "@/app/api/v1/comments/[id]/unhide/route";
import { metaEventJob } from "../../worker/jobs/meta-events";
import { processComment } from "@/server/moderation/engine";
import { executeAction, reconcileStaleActions } from "@/server/actions/outbound";
import { dispatchOutbox } from "../../worker/outbox";
import { handleCallback, connectSelectedPages } from "@/server/meta/pages";
import { resolveWorkspaceContext } from "@/server/rbac/guard";
import { resetEnvCache } from "@/server/env";
import type { Job } from "bullmq";

const SECRET = "test-meta-secret-for-signatures";
const sign = (body: string) => `sha256=${hmacSha256Hex(SECRET, body)}`;

async function postWebhook(payload: unknown, sig?: string) {
  const body = JSON.stringify(payload);
  return call(webhookPost, { method: "POST", rawBody: body, headers: { "x-hub-signature-256": sig ?? sign(body), "content-type": "application/json" }, url: "/api/webhooks/meta" });
}

/** Drain outbox → run jobs inline (no Redis workers in tests). */
async function drain() {
  for (let i = 0; i < 6; i++) {
    const rows = await prisma.webhookOutbox.findMany({ where: { status: "PENDING" } });
    if (!rows.length) break;
    for (const r of rows) {
      await prisma.webhookOutbox.update({ where: { id: r.id }, data: { status: "DISPATCHED", dispatchedAt: new Date() } });
      const p = r.payload as Record<string, string>;
      if (r.topic === "meta.event") await metaEventJob({ data: { eventId: p.eventId } } as Job<{ eventId: string }>);
      else if (r.topic === "moderation.process") await processComment(p.commentId);
      else if (r.topic === "outbound.execute") await executeAction(p.actionId);
    }
  }
}

function commentEvent(id: string, message: string, author = { id: "U1", name: "Rahim" }, page = "PAGE1") {
  return { object: "page", entry: [{ id: page, time: Date.now(), changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: id, post_id: `${page}_P1`, parent_id: `${page}_P1`, from: author, message, created_time: Math.floor(Date.now() / 1000) } }] }] };
}

describe("Meta integration & moderation pipeline", () => {
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let ws: Awaited<ReturnType<typeof makeWorkspace>>;
  let token: string;
  let pageId: string;

  beforeAll(async () => {
    process.env.META_AUTOMATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "sk-test-platform-key-123456789";
    resetEnvCache();
    installMocks();
    await resetDb();
    owner = await makeUser("owner@example.com");
    ws = await makeWorkspace("Coastal", owner.id);
    token = await sessionFor(owner.id);
    const page = await prisma.connectedPage.create({ data: { workspaceId: ws.id, fbPageId: "PAGE1", name: "Coastal Manpower", status: "CONNECTED", grantedScopes: ["pages_manage_engagement", "pages_messaging"], webhookSubscribed: true, moderationMode: "AUTO" } });
    await prisma.metaCredential.create({ data: { pageId: page.id, workspaceId: ws.id, tokenEnc: encrypt("EAAPAGE1TOKEN"), scopes: [] } });
    pageId = page.id;
  });
  beforeEach(() => resetMocks());

  it("webhook verification handshake", async () => {
    const ok = await call(webhookGet, { url: "/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=testverifytoken1234567890&hub.challenge=abc123" });
    expect(ok.status).toBe(200);
    expect(ok.json).toBe("abc123");
    const bad = await call(webhookGet, { url: "/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123" });
    expect(bad.status).toBe(403);
  });

  it("rejects invalid signatures, dedupes redeliveries, stores events durably", async () => {
    const payload = commentEvent("PAGE1_C1", "inbox me for 100% guaranteed visa, pay now!! www.scam.xyz");
    const bad = await postWebhook(payload, "sha256=deadbeef");
    expect(bad!.status).toBe(401);
    expect(await prisma.webhookEvent.count({ where: { signatureValid: false } })).toBe(1);
    const ok = await postWebhook(payload);
    expect(ok!.status).toBe(200);
    const dup = await postWebhook(payload);
    expect(dup!.status).toBe(200);
    expect(await prisma.webhookEvent.count({ where: { dedupeKey: "feed:PAGE1_C1:add" } })).toBe(1);
    expect(await prisma.webhookOutbox.count({ where: { topic: "meta.event", status: "PENDING" } })).toBe(1);
  });

  it("auto-hide stays OFF by default even in AUTO mode: spam goes to review", async () => {
    await drain();
    const comment = await prisma.comment.findFirst({ where: { fbCommentId: "PAGE1_C1" }, include: { classifications: true, decisions: true } });
    expect(comment?.status).toBe("ANALYZED");
    expect(comment?.classifications[0].category).toBe("SPAM");
    expect(comment?.decisions[0].decision).toBe("REVIEW");
    expect(comment?.decisions[0].reviewStatus).toBe("PENDING");
    expect(comment?.decisions[0].reasons.join(" ")).toContain("auto-hide not activated");
    expect(mock.graphCalls.filter((c) => c.url.includes("is_hidden"))).toHaveLength(0);
  });

  it("explicit activation + per-category threshold → automatic hide with audit and usage", async () => {
    const r = await call(configRoute, { token, workspace: ws.slug, method: "PATCH", params: { id: pageId }, body: { autoHideEnabled: true, settings: { categories: { SPAM: { autoHide: true, threshold: 0.9 }, SCAM: { autoHide: true, threshold: 0.9 } } } } });
    expect(r.status).toBe(200);
    await postWebhook(commentEvent("PAGE1_C2", "inbox me for 100% guaranteed visa, pay now!! www.scam.xyz", { id: "U2", name: "Spammer" }));
    await drain();
    const c = await prisma.comment.findFirst({ where: { fbCommentId: "PAGE1_C2" }, include: { decisions: true, actions: true } });
    expect(c?.decisions[0].decision).toBe("HIDE");
    expect(c?.decisions[0].autoExecuted).toBe(true);
    expect(c?.isHidden).toBe(true);
    expect(c?.actions[0].status).toBe("SUCCEEDED");
    expect(mock.graphCalls.filter((g) => g.url.includes("is_hidden=true"))).toHaveLength(1);
    const usage = await prisma.usageCounter.findFirst({ where: { workspaceId: ws.id, metric: "AUTO_HIDE" } });
    expect(Number(usage?.value)).toBe(1);
    expect(await prisma.auditLog.count({ where: { workspaceId: ws.id, action: "outbound.hide_comment_succeeded" } })).toBe(1);
  });

  it("legitimate complaints are never auto-hidden, even if the model says HIDE", async () => {
    mock.aiResponse = () => ({ language: "bn", category: "COMPLAINT", sentiment: "negative", confidence: 0.97, risk_score: 0.3, reasoning: "Customer unhappy with delay", recommended_action: "HIDE", suggested_reply: null });
    await postWebhook(commentEvent("PAGE1_C3", "আপনাদের সার্ভিস নিয়ে আমি সন্তুষ্ট নই, ৩ মাস ধরে ঘুরাচ্ছেন", { id: "U3", name: "Karim" }));
    await drain();
    const c = await prisma.comment.findFirst({ where: { fbCommentId: "PAGE1_C3" }, include: { decisions: true, classifications: true } });
    expect(c?.classifications[0].recommendedAction).toBe("REVIEW"); // deterministic rules downgraded HIDE
    expect(c?.decisions[0].decision).toBe("REVIEW");
    expect(c?.isHidden).toBe(false);
  });

  it("low-confidence harmful classifications become UNCERTAIN → review", async () => {
    mock.aiResponse = () => ({ language: "en", category: "ABUSE", sentiment: "negative", confidence: 0.5, risk_score: 0.6, reasoning: "maybe rude", recommended_action: "HIDE", suggested_reply: null });
    await postWebhook(commentEvent("PAGE1_C4", "whatever man", { id: "U4", name: "X" }));
    await drain();
    const c = await prisma.comment.findFirst({ where: { fbCommentId: "PAGE1_C4" }, include: { classifications: true } });
    expect(c?.classifications[0].category).toBe("UNCERTAIN");
    expect(c?.isHidden).toBe(false);
  });

  it("kill switch blocks automation; approval still works manually; unhide records false positive", async () => {
    await call(configRoute, { token, workspace: ws.slug, method: "PATCH", params: { id: pageId }, body: { killSwitch: true } });
    await postWebhook(commentEvent("PAGE1_C5", "spam spam www.scam.xyz", { id: "U5", name: "S" }));
    await drain();
    const c = await prisma.comment.findFirst({ where: { fbCommentId: "PAGE1_C5" }, include: { decisions: true } });
    expect(c?.isHidden).toBe(false);
    expect(c?.decisions[0].reviewStatus).toBe("PENDING");
    await call(configRoute, { token, workspace: ws.slug, method: "PATCH", params: { id: pageId }, body: { killSwitch: false } });
    const approve = await call(reviewRoute, { token, workspace: ws.slug, params: { id: c!.decisions[0].id }, body: { outcome: "APPROVE", note: "confirmed spam" } });
    expect(approve.status).toBe(200);
    await drain();
    expect((await prisma.comment.findUnique({ where: { id: c!.id } }))?.isHidden).toBe(true);
    const un = await call(unhideRoute, { token, workspace: ws.slug, params: { id: c!.id }, body: { note: "actually a customer" } });
    expect(un.status).toBe(200);
    await drain();
    expect((await prisma.comment.findUnique({ where: { id: c!.id } }))?.isHidden).toBe(false);
    // approving again is impossible (already reviewed) and a second approval cannot double-hide
    const again = await call(reviewRoute, { token, workspace: ws.slug, params: { id: c!.decisions[0].id }, body: { outcome: "APPROVE" } });
    expect(again.status).toBe(409);
  });

  it("reply idempotency: the same decision can never produce two replies, even across crashes", async () => {
    mock.aiResponse = () => ({ language: "bn", category: "INQUIRY", sentiment: "neutral", confidence: 0.95, risk_score: 0, reasoning: "asks about service", recommended_action: "REPLY", suggested_reply: "ধন্যবাদ! বিস্তারিত জানতে আমাদের অফিসে যোগাযোগ করুন।" });
    await call(configRoute, { token, workspace: ws.slug, method: "PATCH", params: { id: pageId }, body: { replyMode: "LIMITED_AUTO", settings: { categories: { SPAM: { autoHide: true, threshold: 0.9 } }, autoReplyCategories: ["INQUIRY"], replyMinConfidence: 0.8 } } });
    await postWebhook(commentEvent("PAGE1_C6", "আপনাদের সার্ভিস সম্পর্কে বিস্তারিত জানতে চাই।", { id: "U6", name: "Asif" }));
    await drain();
    const action = await prisma.outboundAction.findFirst({ where: { type: "REPLY_COMMENT", targetId: "PAGE1_C6" } });
    expect(action?.status).toBe("SUCCEEDED");
    // Re-run processing & execution as a crashed worker would: nothing new is sent.
    await processComment((await prisma.comment.findFirst({ where: { fbCommentId: "PAGE1_C6" } }))!.id);
    await executeAction(action!.id);
    await drain();
    expect(await prisma.outboundAction.count({ where: { type: "REPLY_COMMENT", targetId: "PAGE1_C6" } })).toBe(1);
    expect(mock.graphCalls.filter((g) => g.url.includes("PAGE1_C6/comments") && g.method === "POST")).toHaveLength(1);
  });

  it("concurrent workers cannot execute the same action twice (atomic claim)", async () => {
    const { requestAction } = await import("@/server/actions/outbound");
    const { action } = await requestAction({ workspaceId: ws.id, pageId, type: "HIDE_COMMENT", targetId: "PAGE1_C2", idempotencyKey: "race-test" });
    const results = await Promise.all([executeAction(action.id, "w1"), executeAction(action.id, "w2"), executeAction(action.id, "w3")]);
    expect(results.filter((r) => "skipped" in r && r.skipped)).toHaveLength(2);
    expect(mock.graphCalls.filter((g) => g.url.includes("PAGE1_C2") && g.url.includes("is_hidden"))).toHaveLength(1);
  });

  it("reconciliation recovers a reply that went out before the crash instead of resending", async () => {
    const { requestAction } = await import("@/server/actions/outbound");
    const { action } = await requestAction({ workspaceId: ws.id, pageId, type: "REPLY_COMMENT", targetId: "PAGE1_C9", idempotencyKey: "recon-1", payload: { message: "Hello there" } });
    // Simulate: worker sent the reply, then died before marking success.
    mock.commentReplies["PAGE1_C9"] = [{ id: "reply_existing", from: { id: "PAGE1" }, message: "Hello there" }];
    await prisma.outboundAction.update({ where: { id: action.id }, data: { status: "CLAIMED", lockedUntil: new Date(Date.now() - 1000), attempts: 1 } });
    const r = await reconcileStaleActions();
    expect(r.resolved).toBe(1);
    const a = await prisma.outboundAction.findUnique({ where: { id: action.id } });
    expect(a?.status).toBe("SUCCEEDED");
    expect(a?.externalId).toBe("reply_existing");
    expect(mock.graphCalls.filter((g) => g.method === "POST" && g.url.includes("PAGE1_C9/comments"))).toHaveLength(0);
  });

  it("transient Graph errors retry with backoff; auth errors invalidate the Page and cancel pending actions", async () => {
    const { requestAction } = await import("@/server/actions/outbound");
    mock.graphFail = (url) => (url.includes("PAGE1_C10") ? new Response(JSON.stringify({ error: { message: "temporarily unavailable", code: 2 } }), { status: 500 }) : null);
    const { action } = await requestAction({ workspaceId: ws.id, pageId, type: "HIDE_COMMENT", targetId: "PAGE1_C10", idempotencyKey: "transient-1" });
    await executeAction(action.id);
    expect((await prisma.outboundAction.findUnique({ where: { id: action.id } }))?.status).toBe("PENDING");
    mock.graphFail = (url) => (url.includes("PAGE1_C11") ? new Response(JSON.stringify({ error: { message: "Error validating access token", code: 190, type: "OAuthException" } }), { status: 400 }) : null);
    const { action: a2 } = await requestAction({ workspaceId: ws.id, pageId, type: "HIDE_COMMENT", targetId: "PAGE1_C11", idempotencyKey: "auth-1" });
    await prisma.outboundAction.update({ where: { id: action.id }, data: { scheduledAt: new Date() } });
    await executeAction(a2.id);
    const page = await prisma.connectedPage.findUnique({ where: { id: pageId } });
    expect(page?.status).toBe("TOKEN_INVALID");
    expect((await prisma.outboundAction.findUnique({ where: { id: action.id } }))?.status).toBe("CANCELLED");
    expect(await prisma.emailDelivery.count({ where: { templateKey: "ops.permission_revoked" } })).toBeGreaterThan(0);
    await prisma.connectedPage.update({ where: { id: pageId }, data: { status: "CONNECTED" } });
  });

  it("OAuth: state must match cookie + DB, is single-use, and Page selection connects + verifies webhooks", async () => {
    const ctx = await resolveWorkspaceContext(owner, ws.slug);
    const { beginConnect } = await import("@/server/meta/pages");
    const { state } = await beginConnect(ctx);
    await expect(handleCallback({ code: "c", state, cookieState: "other", userId: owner.id })).rejects.toThrow(/INVALID_OAUTH_STATE/);
    const other = await makeUser("intruder@example.com");
    await expect(handleCallback({ code: "c", state, cookieState: state, userId: other.id })).rejects.toThrow(/different user/);
    const result = await handleCallback({ code: "c", state, cookieState: state, userId: owner.id });
    expect(result.pages.map((p) => p.id)).toEqual(["PAGE1", "PAGE2"]);
    expect(result.pages[0].alreadyConnected).toBe(true);
    await expect(handleCallback({ code: "c", state, cookieState: state, userId: owner.id })).rejects.toThrow(/INVALID_OAUTH_STATE/);
    const sel = await connectSelectedPages(ctx, result.selectionToken, ["PAGE2"], {});
    expect(sel.results[0].webhookSubscribed).toBe(true);
    const page2 = await prisma.connectedPage.findUnique({ where: { workspaceId_fbPageId: { workspaceId: ws.id, fbPageId: "PAGE2" } }, include: { credential: true } });
    expect(page2?.credential?.tokenEnc.startsWith("v1.")).toBe(true);
    expect(page2?.credential?.tokenEnc).not.toContain("EAAPAGE2TOKEN");
    // plan limit: growth allows 5 pages — simulate reaching it
    await prisma.subscription.update({ where: { workspaceId: ws.id }, data: { limitOverrides: { pages: 2 } } });
    await expect(beginConnect(await resolveWorkspaceContext(owner, ws.slug))).rejects.toThrow(/plan allows 2 pages/);
    await prisma.subscription.update({ where: { workspaceId: ws.id }, data: { limitOverrides: {} } });
  });

  it("disconnect requires exact name confirmation, removes credentials, keeps history, only affects that Page", async () => {
    const page2 = await prisma.connectedPage.findUnique({ where: { workspaceId_fbPageId: { workspaceId: ws.id, fbPageId: "PAGE2" } } });
    const wrong = await call(disconnectRoute, { token, workspace: ws.slug, params: { id: page2!.id }, body: { confirmName: "Wrong" } });
    expect(wrong.status).toBe(400);
    const ok = await call(disconnectRoute, { token, workspace: ws.slug, params: { id: page2!.id }, body: { confirmName: "Second Page" } });
    expect(ok.status).toBe(200);
    expect(ok.json.webhookRemoved).toBe(true);
    const after = await prisma.connectedPage.findUnique({ where: { id: page2!.id }, include: { credential: true } });
    expect(after?.status).toBe("DISCONNECTED");
    expect(after?.credential).toBeNull();
    expect((await prisma.connectedPage.findUnique({ where: { id: pageId }, include: { credential: true } }))?.credential).toBeTruthy();
    expect(await prisma.comment.count({ where: { pageId } })).toBeGreaterThan(0);
    // other tenant cannot disconnect
    const other = await makeUser("tenant2@example.com");
    const ws2 = await makeWorkspace("Other", other.id);
    const t2 = await sessionFor(other.id);
    const cross = await call(disconnectRoute, { token: t2, workspace: ws2.slug, params: { id: pageId }, body: { confirmName: "Coastal Manpower" } });
    expect(cross.status).toBe(404);
  });

  it("outbox dispatcher is idempotent and marks rows dispatched", async () => {
    await prisma.webhookOutbox.create({ data: { topic: "email.send", payload: { deliveryId: "x" } } });
    const r = await dispatchOutbox();
    expect(r.claimed).toBeGreaterThanOrEqual(1);
    // Only rows whose availableAt is in the past are claimed; delayed retries stay pending until due.
    expect(await prisma.webhookOutbox.count({ where: { status: "PENDING", availableAt: { lte: new Date() } } })).toBe(0);
  });
});
