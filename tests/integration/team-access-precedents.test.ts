/**
 * Team access limits (per-member Pages / agents), personal BYOK keys incl. Anthropic, Page guidance,
 * and reviewer precedents ("always hide / never hide comments like this").
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { call, makeUser, makeWorkspace, resetDb, sessionFor } from "../helpers";
import { installMocks, mock, resetMocks } from "../mocks";
import { encrypt } from "@/server/crypto";
import { resetEnvCache } from "@/server/env";
import { GET as pagesList } from "@/app/api/v1/pages/route";
import { PATCH as configRoute } from "@/app/api/v1/pages/[id]/config/route";
import { GET as commentsList } from "@/app/api/v1/comments/route";
import { GET as commentDetail } from "@/app/api/v1/comments/[id]/route";
import { POST as hideRoute } from "@/app/api/v1/comments/[id]/hide/route";
import { POST as reviewRoute } from "@/app/api/v1/moderation/decisions/[id]/route";
import { GET as precedentsList, POST as precedentCreate } from "@/app/api/v1/moderation/precedents/route";
import { PATCH as precedentPatch } from "@/app/api/v1/moderation/precedents/[id]/route";
import { POST as inviteRoute, PATCH as memberPatch } from "@/app/api/v1/team/members/route";
import { POST as agentCreate } from "@/app/api/v1/agents/route";
import { POST as credentialCreate, GET as credentialList } from "@/app/api/v1/ai/credentials/route";
import { processComment } from "@/server/moderation/engine";
import { executeAction } from "@/server/actions/outbound";
import { similarity, matchPrecedents } from "@/server/moderation/precedents";
import { complete } from "@/server/ai/gateway";

async function drain() {
  for (let i = 0; i < 6; i++) {
    const rows = await prisma.webhookOutbox.findMany({ where: { status: "PENDING" } });
    if (!rows.length) break;
    for (const r of rows) {
      await prisma.webhookOutbox.update({ where: { id: r.id }, data: { status: "DISPATCHED", dispatchedAt: new Date() } });
      const p = r.payload as Record<string, string>;
      if (r.topic === "moderation.process") await processComment(p.commentId);
      else if (r.topic === "outbound.execute") await executeAction(p.actionId);
    }
  }
}

const classify = (category: string, action: string, conf = 0.9, extra: Record<string, unknown> = {}) => ({ language: "bn", category, sentiment: "negative", confidence: conf, risk_score: 0.5, reasoning: "mock", recommended_action: action, intent: "", suggested_reply: null, precedent_match: null, ...extra });

describe("team access limits, personal keys and learned rulings", () => {
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let staff: Awaited<ReturnType<typeof makeUser>>;
  let ws: Awaited<ReturnType<typeof makeWorkspace>>;
  let ownerToken: string;
  let staffToken: string;
  let pageA: string;
  let pageB: string;
  let seq = 0;

  async function newComment(page: string, message: string, author = "U9") {
    seq++;
    const c = await prisma.comment.create({ data: { workspaceId: ws.id, pageId: page, fbCommentId: `C_${seq}`, fbPostId: "P1", authorFbId: author, authorName: "Tester", message, createdTime: new Date(), status: "NEW" } });
    await processComment(c.id);
    await drain();
    return prisma.comment.findUniqueOrThrow({ where: { id: c.id }, include: { classifications: { orderBy: { createdAt: "desc" } }, decisions: { orderBy: { createdAt: "desc" } } } });
  }

  beforeAll(async () => {
    process.env.META_AUTOMATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "sk-test-platform-key-123456789";
    resetEnvCache();
    installMocks();
    await resetDb();
    owner = await makeUser("owner2@example.com");
    staff = await makeUser("staff@example.com");
    ws = await makeWorkspace("Creative", owner.id);
    ownerToken = await sessionFor(owner.id);
    staffToken = await sessionFor(staff.id);
    for (const [fb, name] of [["PAGE_A", "Page A"], ["PAGE_B", "Page B"]] as const) {
      const p = await prisma.connectedPage.create({ data: { workspaceId: ws.id, fbPageId: fb, name, status: "CONNECTED", grantedScopes: ["pages_manage_engagement"], webhookSubscribed: true, moderationMode: "AUTO", autoHideEnabled: true, settings: { categories: { SPAM: { autoHide: true, threshold: 0.9 } } } } });
      await prisma.metaCredential.create({ data: { pageId: p.id, workspaceId: ws.id, tokenEnc: encrypt("EAATOKEN"), scopes: [] } });
      if (fb === "PAGE_A") pageA = p.id;
      else pageB = p.id;
    }
  });
  beforeEach(() => resetMocks());

  // ───────────────────────── Team access limits ─────────────────────────
  it("owner invites a member limited to one Page and one agent; the limits are enforced server-side", async () => {
    const roles = await prisma.role.findMany({ where: { workspaceId: ws.id } });
    const moderator = roles.find((r) => r.key === "admin")!;
    const inv = await call(inviteRoute, { token: ownerToken, workspace: ws.slug, method: "POST", body: { email: staff.email, roleId: moderator.id, access: { pageAccess: "ASSIGNED", allowedPageIds: [pageA], maxPages: 1, maxAgents: 1 } } });
    expect(inv.status).toBe(200);
    const stored = await prisma.invitation.findFirstOrThrow({ where: { workspaceId: ws.id, email: staff.email } });
    expect(stored.allowedPageIds).toEqual([pageA]);
    expect(stored.maxAgents).toBe(1);
    // Accept via direct membership (acceptance flow is covered in tenant-team tests)
    await prisma.membership.create({ data: { userId: staff.id, workspaceId: ws.id, roleId: moderator.id, pageAccess: "ASSIGNED", allowedPageIds: [pageA], maxPages: 1, maxAgents: 1 } });

    const pages = await call(pagesList, { token: staffToken, workspace: ws.slug });
    expect((pages.json.pages as { id: string }[]).map((p) => p.id)).toEqual([pageA]);

    // Cannot configure the other Page (404 — existence not revealed)
    const cfg = await call(configRoute, { token: staffToken, workspace: ws.slug, method: "PATCH", params: { id: pageB }, body: { killSwitch: true } });
    expect(cfg.status).toBe(404);

    // Comments of Page B are invisible
    mock.aiResponse = () => classify("NEUTRAL", "KEEP");
    const cb = await newComment(pageB, "hello from B");
    const list = await call(commentsList, { token: staffToken, workspace: ws.slug, url: "/api/v1/comments" });
    expect((list.json.rows as { id: string }[]).some((r) => r.id === cb.id)).toBe(false);
    const detail = await call(commentDetail, { token: staffToken, workspace: ws.slug, params: { id: cb.id } });
    expect(detail.status).toBe(404);
    const hide = await call(hideRoute, { token: staffToken, workspace: ws.slug, method: "POST", params: { id: cb.id }, body: {} });
    expect(hide.status).toBe(404);

    // One agent allowed, second refused
    const version = { instructions: "Classify comments for our agency carefully.", languages: ["bn"], tone: "neutral", provider: "openai", model: "gpt-4.1-mini", temperature: 0.2 };
    const a1 = await call(agentCreate, { token: staffToken, workspace: ws.slug, method: "POST", body: { name: "Staff agent 1", purpose: "MODERATION", version } });
    expect(a1.status).toBe(200);
    const a2 = await call(agentCreate, { token: staffToken, workspace: ws.slug, method: "POST", body: { name: "Staff agent 2", purpose: "MODERATION", version } });
    expect(a2.status).toBe(403);
    expect(String((a2.json.error as { message: string }).message)).toContain("at most 1 AI agent");

    // Owner raises the limit through the Access editor
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: staff.id, workspaceId: ws.id } });
    const up = await call(memberPatch, { token: ownerToken, workspace: ws.slug, method: "PATCH", body: { membershipId: m.id, access: { maxAgents: 3 } } });
    expect(up.status).toBe(200);
    const a3 = await call(agentCreate, { token: staffToken, workspace: ws.slug, method: "POST", body: { name: "Staff agent 2", purpose: "MODERATION", version } });
    expect(a3.status).toBe(200);
    // A member with assigned Pages cannot hand out access to all Pages
    const bad = await call(memberPatch, { token: staffToken, workspace: ws.slug, method: "PATCH", body: { membershipId: m.id, access: { pageAccess: "ALL" } } });
    expect([403]).toContain(bad.status);
  });

  // ───────────────────────── Personal BYOK keys + Anthropic ─────────────────────────
  it("a member adds a personal Claude key, pins an agent to it, and the request goes to Anthropic with that key", async () => {
    mock.aiResponse = () => ({ ok: true });
    const add = await call(credentialCreate, { token: staffToken, workspace: ws.slug, method: "POST", body: { provider: "anthropic", apiKey: "sk-ant-staff-personal-key-000000", label: "my claude", scope: "PERSONAL" } });
    expect(add.status).toBe(200);
    const credId = (add.json.credential as { id: string }).id;
    // Owner (ai.credentials holder) does NOT see the staff member's personal key
    const ownerView = await call(credentialList, { token: ownerToken, workspace: ws.slug });
    expect((ownerView.json.credentials as { id: string }[]).some((c) => c.id === credId)).toBe(false);
    // Staff cannot add a workspace-wide key without ai.credentials? (admin role holds it) → owner-only check skipped; instead pin agent
    const version = { instructions: "Classify comments for our agency carefully.", languages: ["bn"], tone: "neutral", provider: "anthropic", model: "claude-sonnet-4-5", temperature: 0.2, credentialId: credId };
    const ag = await call(agentCreate, { token: staffToken, workspace: ws.slug, method: "POST", body: { name: "Claude brain", purpose: "MODERATION", version, activate: true } });
    expect(ag.status).toBe(200);
    const agentId = (ag.json.agent as { id: string }).id;
    // Another member cannot pin to someone else's personal key
    const steal = await call(agentCreate, { token: ownerToken, workspace: ws.slug, method: "POST", body: { name: "Steal", purpose: "MODERATION", version } });
    expect(steal.status).toBe(403);

    // Use it: metered completion through the gateway with the pinned credential
    mock.aiResponse = () => classify("NEGATIVE", "HIDE", 0.9);
    const res = await complete({ workspaceId: ws.id, purpose: "TEST", credentialId: credId, messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }], json: true });
    expect(res.provider).toBe("anthropic");
    expect(mock.lastAnthropicRequest?.headers["x-api-key"]).toBe("sk-ant-staff-personal-key-000000");
    expect(res.text.trimStart().startsWith("{")).toBe(true); // "{" prefill re-attached
    const usage = await prisma.aiUsage.findFirst({ where: { workspaceId: ws.id, provider: "anthropic" }, orderBy: { createdAt: "desc" } });
    expect(usage?.credentialMode).toBe("BYOK");
    expect(usage?.success).toBe(true);
    void agentId;
  });

  // ───────────────────────── Page guidance ─────────────────────────
  it("Page owner's plain-language instructions reach the classifier prompt", async () => {
    const cfg = await call(configRoute, { token: ownerToken, workspace: ws.slug, method: "PATCH", params: { id: pageA }, body: { settings: { categories: { SPAM: { autoHide: true, threshold: 0.9 } }, moderationGuidance: "অন্য এজেন্সির প্রচার হাইড করবে" } } });
    expect(cfg.status).toBe(200);
    let seenSys = "";
    mock.aiResponse = () => (_t: string, sys: string) => { seenSys = sys; return classify("NEUTRAL", "KEEP"); };
    await newComment(pageA, "hello");
    expect(seenSys).toContain("Page owner's moderation instructions");
    expect(seenSys).toContain("অন্য এজেন্সির প্রচার হাইড করবে");
  });

  // ───────────────────────── Learned rulings ─────────────────────────
  it("similarity helper recognises near-identical Bengali text and ignores unrelated text", () => {
    expect(similarity("এরা বাটপার, পাসপোর্ট দিয়ে জীবনের সর্বনাশ হয়ে গেল", "এরা বাটপার পাসপোর্ট দিয়ে জীবনের সর্বনাশ হয়ে গেল!!")).toBeGreaterThan(0.85);
    expect(similarity("এরা বাটপার, পাসপোর্ট দিয়ে জীবনের সর্বনাশ হয়ে গেল", "ভিসা প্রসেসিং কত দিন লাগে?")).toBeLessThan(0.3);
    const m = matchPrecedents("এরা বাটপার পাসপোর্ট দিয়ে জীবনের সর্বনাশ হয়ে গেল", [{ id: "p1", pageId: null, text: "এরা বাটপার, পাসপোর্ট দিয়ে জীবনের সর্বনাশ হয়ে গেল", normalizedText: "x", category: "DEFAMATION", decision: "HIDE", note: "" }]);
    expect(m.exact?.id).toBe("p1");
  });

  it("AI is unsure → review queue; reviewer hides with “always” → identical comment later is hidden without an AI call, paraphrase is hidden via the model", async () => {
    // 1) The AI is unsure: NEGATIVE at low confidence → REVIEW (hideNegativeSentiment is off on Page A anyway)
    mock.aiResponse = () => classify("NEGATIVE", "REVIEW", 0.6);
    const c1 = await newComment(pageA, "পাসপোর্ট জমা দিয়ে আমার জীবন শেষ, এদের কাছে কেউ যাবেন না");
    expect(c1.decisions[0].decision).toBe("REVIEW");
    expect(c1.decisions[0].reviewStatus).toBe("PENDING");
    expect(c1.isHidden).toBe(false);

    // 2) Reviewer hides it and ticks "always hide comments like this" for this Page
    const rv = await call(reviewRoute, { token: ownerToken, workspace: ws.slug, method: "POST", params: { id: c1.decisions[0].id }, body: { outcome: "APPROVE", always: true, alwaysScope: "PAGE", alwaysNote: "ruins-life accusation" } });
    expect(rv.status).toBe(200);
    expect(rv.json.precedentId).toBeTruthy();
    await drain();
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: c1.id } })).isHidden).toBe(true);
    const p = await prisma.moderationPrecedent.findUniqueOrThrow({ where: { id: rv.json.precedentId as string } });
    expect(p.decision).toBe("HIDE");
    expect(p.pageId).toBe(pageA);
    expect(p.category).toBe("NEGATIVE");

    // 3) Identical comment (minor punctuation change) → hidden automatically, zero AI calls, even though
    //    hideNegativeSentiment is off and NEGATIVE has no auto-hide switch on this Page.
    const callsBefore = mock.aiCalls;
    const c2 = await newComment(pageA, "পাসপোর্ট জমা দিয়ে আমার জীবন শেষ!! এদের কাছে কেউ যাবেন না", "U10");
    expect(mock.aiCalls).toBe(callsBefore);
    expect(c2.classifications[0].provider).toBe("precedent");
    expect(c2.classifications[0].precedentId).toBe(p.id);
    expect(c2.decisions[0].decision).toBe("HIDE");
    expect(c2.decisions[0].autoExecuted).toBe(true);
    expect(c2.decisions[0].reasons.join(" ")).toContain("reviewer ruling");
    expect(c2.isHidden).toBe(true);
    expect((await prisma.moderationPrecedent.findUniqueOrThrow({ where: { id: p.id } })).hits).toBe(1);

    // 4) Paraphrase: the model sees the ruling in its prompt and reports precedent_match → hidden automatically
    let promptHadRuling = false;
    mock.aiResponse = () => (_t: string, sys: string) => {
      promptHadRuling = sys.includes("Reviewer rulings") && sys.includes(p.id);
      return classify("COMPLAINT", "REVIEW", 0.7, { precedent_match: p.id });
    };
    const c3 = await newComment(pageA, "passport diye amar life ta shesh kore dilo era", "U11");
    expect(promptHadRuling).toBe(true);
    expect(c3.classifications[0].precedentId).toBe(p.id);
    expect(c3.decisions[0].autoExecuted).toBe(true);
    expect(c3.isHidden).toBe(true);

    // 5) Scope: the ruling is for Page A only — the same text on Page B is not auto-hidden by it
    mock.aiResponse = () => classify("NEGATIVE", "REVIEW", 0.6);
    const c4 = await newComment(pageB, "পাসপোর্ট জমা দিয়ে আমার জীবন শেষ, এদের কাছে কেউ যাবেন না", "U12");
    expect(c4.classifications[0].precedentId).toBeNull();
    expect(c4.isHidden).toBe(false);

    // 6) Widen to all Pages → now Page B is covered too
    const widen = await call(precedentPatch, { token: ownerToken, workspace: ws.slug, method: "PATCH", params: { id: p.id }, body: { scope: "WORKSPACE" } });
    expect(widen.status).toBe(200);
    const c5 = await newComment(pageB, "পাসপোর্ট জমা দিয়ে আমার জীবন শেষ, এদের কাছে কেউ যাবেন না", "U13");
    expect(c5.isHidden).toBe(true);

    // 7) A model-invented ruling id is ignored
    mock.aiResponse = () => classify("NEGATIVE", "REVIEW", 0.6, { precedent_match: "not-a-real-id" });
    const c6 = await newComment(pageA, "service onek slow", "U14");
    expect(c6.classifications[0].precedentId).toBeNull();
    expect(c6.isHidden).toBe(false);

    // 8) Disabled rulings stop applying
    await call(precedentPatch, { token: ownerToken, workspace: ws.slug, method: "PATCH", params: { id: p.id }, body: { status: "DISABLED" } });
    mock.aiResponse = () => classify("NEGATIVE", "REVIEW", 0.6);
    const c7 = await newComment(pageA, "পাসপোর্ট জমা দিয়ে আমার জীবন শেষ, এদের কাছে কেউ যাবেন না", "U15");
    expect(c7.classifications[0].precedentId).toBeNull();
    expect(c7.isHidden).toBe(false);
    const list = await call(precedentsList, { token: ownerToken, workspace: ws.slug, url: "/api/v1/moderation/precedents" });
    expect(list.json.total).toBe(1);
  });

  it("“never hide” ruling keeps a comment visible even when the model wants to hide it", async () => {
    mock.aiResponse = () => classify("SPAM", "HIDE", 0.97);
    const c1 = await newComment(pageA, "আমাদের অফিসের ঠিকানা: নয়া পল্টন, ঢাকা — সবাই আসুন", "U20");
    expect(c1.decisions[0].decision).toBe("HIDE");
    expect(c1.isHidden).toBe(true); // SPAM auto-hide is on
    const make = await call(precedentCreate, { token: ownerToken, workspace: ws.slug, method: "POST", body: { commentId: c1.id, decision: "KEEP", scope: "WORKSPACE", note: "our own announcement" } });
    expect(make.status).toBe(200);
    const before = mock.aiCalls;
    const c2 = await newComment(pageB, "আমাদের অফিসের ঠিকানা: নয়া পল্টন, ঢাকা — সবাই আসুন!", "U21");
    expect(mock.aiCalls).toBe(before); // exact match, no model call
    expect(c2.decisions[0].decision).toBe("KEEP");
    expect(c2.decisions[0].reasons.join(" ")).toContain("kept per reviewer ruling");
    expect(c2.isHidden).toBe(false);
  });

  it("a HIDE ruling never auto-hides a protected category: it is stored as NEGATIVE", async () => {
    mock.aiResponse = () => classify("INQUIRY", "REVIEW", 0.5);
    const c1 = await newComment(pageA, "ভাই কত টাকা লাগবে বলেন তো, নাকি সব ভুয়া?", "U30");
    const make = await call(precedentCreate, { token: ownerToken, workspace: ws.slug, method: "POST", body: { commentId: c1.id, decision: "HIDE", scope: "PAGE" } });
    expect(make.status).toBe(200);
    expect((make.json.precedent as { category: string }).category).toBe("NEGATIVE");
  });
});
