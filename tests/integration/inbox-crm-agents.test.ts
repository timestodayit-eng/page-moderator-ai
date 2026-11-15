import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { call, makeUser, makeWorkspace, resetDb, sessionFor } from "../helpers";
import { installMocks, mock, resetMocks } from "../mocks";
import { resetEnvCache } from "@/server/env";
import { encrypt } from "@/server/crypto";
import { ingestMessagingEvent } from "@/server/inbox/ingest";
import { GET as convList } from "@/app/api/v1/inbox/conversations/route";
import { GET as convGet, PATCH as convPatch } from "@/app/api/v1/inbox/conversations/[id]/route";
import { POST as msgPost } from "@/app/api/v1/inbox/conversations/[id]/messages/route";
import { POST as suggestPost } from "@/app/api/v1/inbox/conversations/[id]/suggest/route";
import { GET as leadsGet, POST as leadsPost } from "@/app/api/v1/leads/route";
import { PATCH as leadPatch, GET as leadGet } from "@/app/api/v1/leads/[id]/route";
import { POST as leadFromSource } from "@/app/api/v1/leads/from-source/route";
import { GET as leadsExport } from "@/app/api/v1/leads/export/route";
import { POST as agentsPost, GET as agentsGet } from "@/app/api/v1/agents/route";
import { POST as versionsPost } from "@/app/api/v1/agents/[id]/versions/route";
import { POST as testPost } from "@/app/api/v1/agents/[id]/test/route";
import { POST as evalPost } from "@/app/api/v1/agents/[id]/evaluations/route";
import { POST as knowledgePost } from "@/app/api/v1/training/knowledge/route";
import { POST as examplesPost } from "@/app/api/v1/training/examples/route";
import { GET as trainingStats } from "@/app/api/v1/training/stats/route";
import { POST as credPost, PATCH as credPatch } from "@/app/api/v1/ai/credentials/route";
import { executeAction } from "@/server/actions/outbound";
import { runEvaluation } from "@/server/agents/evaluation";
import { retrieveKnowledge } from "@/server/agents/knowledge";
import { sendFollowUpReminders } from "@/server/crm/reminders";

describe("Messenger inbox, CRM, agents & training", () => {
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let token: string;
  let ws: Awaited<ReturnType<typeof makeWorkspace>>;
  let page: Awaited<ReturnType<typeof prisma.connectedPage.create>>;
  let supportToken: string;
  let supportUser: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(async () => {
    process.env.META_AUTOMATION_ENABLED = "true";
    process.env.OPENAI_API_KEY = "sk-test-platform-key-123456789";
    resetEnvCache();
    installMocks();
    await resetDb();
    owner = await makeUser("owner@example.com");
    token = await sessionFor(owner.id);
    ws = await makeWorkspace("Coastal", owner.id);
    page = await prisma.connectedPage.create({ data: { workspaceId: ws.id, fbPageId: "PAGE1", name: "Coastal", status: "CONNECTED", grantedScopes: ["pages_messaging", "pages_manage_engagement"] } });
    await prisma.metaCredential.create({ data: { pageId: page.id, workspaceId: ws.id, tokenEnc: encrypt("EAAPAGE1TOKEN"), scopes: [] } });
    supportUser = await makeUser("support@example.com");
    const role = await prisma.role.findUniqueOrThrow({ where: { workspaceId_key: { workspaceId: ws.id, key: "support" } } });
    await prisma.membership.create({ data: { userId: supportUser.id, workspaceId: ws.id, roleId: role.id } });
    supportToken = await sessionFor(supportUser.id);
  });
  beforeEach(() => resetMocks());

  it("ingests Messenger events idempotently, creates contact + conversation, reopens on new message", async () => {
    const ev = { sender: { id: "PSID1" }, recipient: { id: "PAGE1" }, timestamp: Date.now(), message: { mid: "m1", text: "ভাই সৌদি আরবে কাজের বেতন কত?" } };
    const r1 = await ingestMessagingEvent(page, ev);
    const r2 = await ingestMessagingEvent(page, ev);
    expect("conversationId" in r1).toBe(true);
    expect(r2).toEqual({ duplicate: true });
    const conv = await prisma.conversation.findFirst({ where: { psid: "PSID1" }, include: { contact: true } });
    expect(conv?.status).toBe("NEW");
    expect(conv?.unreadCount).toBe(1);
    expect(conv?.contact.name).toBe("Test Customer");
    await prisma.conversation.update({ where: { id: conv!.id }, data: { status: "RESOLVED" } });
    await ingestMessagingEvent(page, { ...ev, message: { mid: "m2", text: "hello?" } });
    expect((await prisma.conversation.findUnique({ where: { id: conv!.id } }))?.status).toBe("OPEN");
  });

  it("support agent sees unassigned/assigned conversations only; owner sees all; lifecycle enforced", async () => {
    const conv = (await prisma.conversation.findFirst({ where: { psid: "PSID1" } }))!;
    const other = await prisma.contact.create({ data: { workspaceId: ws.id, name: "Other", fbPsid: "PSID2" } });
    const assignedElsewhere = await prisma.conversation.create({ data: { workspaceId: ws.id, pageId: page.id, contactId: other.id, psid: "PSID2", status: "ASSIGNED", assignedToId: owner.id, lastInboundAt: new Date() } });
    const mine = await call(convList, { token: supportToken, workspace: ws.slug });
    expect((mine.json.rows as { id: string }[]).map((r) => r.id)).toEqual([conv.id]);
    const all = await call(convList, { token, workspace: ws.slug });
    expect(all.json.total).toBe(2);
    expect((await call(convGet, { token: supportToken, workspace: ws.slug, params: { id: assignedElsewhere.id } })).status).toBe(404);
    const bad = await call(convPatch, { token, workspace: ws.slug, method: "PATCH", params: { id: conv.id }, body: { status: "RESOLVED" } });
    expect(bad.status).toBe(200); // OPEN → RESOLVED allowed
    const invalid = await call(convPatch, { token, workspace: ws.slug, method: "PATCH", params: { id: conv.id }, body: { status: "PENDING" } });
    expect(invalid.status).toBe(400); // RESOLVED → PENDING not allowed
    await call(convPatch, { token, workspace: ws.slug, method: "PATCH", params: { id: conv.id }, body: { status: "OPEN" } });
    const assign = await call(convPatch, { token, workspace: ws.slug, method: "PATCH", params: { id: conv.id }, body: { assignedToId: supportUser.id, tags: ["Saudi", "salary"] } });
    expect(assign.status).toBe(200);
    expect((await prisma.conversation.findUnique({ where: { id: conv.id } }))?.status).toBe("ASSIGNED");
  });

  it("replies go through the outbound engine, respect the 24h window, and the reply lock prevents double-sending", async () => {
    const conv = (await prisma.conversation.findFirst({ where: { psid: "PSID1" } }))!;
    const r = await call(msgPost, { token: supportToken, workspace: ws.slug, params: { id: conv.id }, body: { text: "আমাদের অফিসে যোগাযোগ করুন।" } });
    expect(r.status).toBe(200);
    await executeAction(r.json.actionId as string);
    const msg = await prisma.message.findUnique({ where: { id: r.json.messageId as string } });
    expect(msg?.status).toBe("SENT");
    expect(mock.graphCalls.filter((g) => g.url.includes("/messages") && g.method === "POST")).toHaveLength(1);
    // window closed → needs tag
    await prisma.conversation.update({ where: { id: conv.id }, data: { lastInboundAt: new Date(Date.now() - 25 * 3_600_000) } });
    const closed = await call(msgPost, { token: supportToken, workspace: ws.slug, params: { id: conv.id }, body: { text: "follow up" } });
    expect(closed.status).toBe(409);
    const tagged = await call(msgPost, { token: supportToken, workspace: ws.slug, params: { id: conv.id }, body: { text: "follow up", tag: "HUMAN_AGENT" } });
    expect(tagged.status).toBe(200);
    // lock held by another user
    await prisma.conversation.update({ where: { id: conv.id }, data: { replyLockById: owner.id, replyLockUntil: new Date(Date.now() + 30_000), lastInboundAt: new Date() } });
    const locked = await call(msgPost, { token: supportToken, workspace: ws.slug, params: { id: conv.id }, body: { text: "x" } });
    expect(locked.status).toBe(409);
    // never start an unsolicited conversation
    const cold = await prisma.conversation.create({ data: { workspaceId: ws.id, pageId: page.id, contactId: (await prisma.contact.create({ data: { workspaceId: ws.id, name: "Cold", fbPsid: "PSID9" } })).id, psid: "PSID9" } });
    expect((await call(msgPost, { token, workspace: ws.slug, params: { id: cold.id }, body: { text: "hi", tag: "HUMAN_AGENT" } })).status).toBe(403);
  });

  it("AI suggestion uses approved knowledge and never sends", async () => {
    const k = await call(knowledgePost, { token, workspace: ws.slug, body: { title: "Saudi salary", kind: "pricing", content: "Saudi Arabia Al Mawarid indoor worker visa: salary 1200 SAR per month, 2 years contract, food and accommodation by company. Processing time 45-60 days." } });
    expect(k.status).toBe(200);
    const hits = await retrieveKnowledge(ws.id, "saudi salary kaj");
    expect(hits.length).toBeGreaterThan(0);
    mock.aiResponse = () => ({ reply: "সৌদি আরবে আল মাওয়ারিদ ভিসায় বেতন ১২০০ রিয়াল।", confidence: 0.9, escalate: false, reason: "from knowledge" });
    const conv = (await prisma.conversation.findFirst({ where: { psid: "PSID1" } }))!;
    const s = await call(suggestPost, { token, workspace: ws.slug, params: { id: conv.id } });
    expect(s.status).toBe(200);
    expect(s.json.knowledgeUsed).toBeGreaterThan(0);
    expect(mock.graphCalls.filter((g) => g.method === "POST")).toHaveLength(0);
    expect(await prisma.aiUsage.count({ where: { workspaceId: ws.id, purpose: "MESSENGER", success: true } })).toBe(1);
  });

  it("CRM: leads with pipeline, assignment scoping, follow-up tasks, export permission", async () => {
    const created = await call(leadsPost, { token, workspace: ws.slug, body: { contact: { name: "Rahim Uddin", phone: "01712345678" }, title: "Saudi driver visa", source: "MANUAL", assignedToId: supportUser.id, followUpAt: new Date(Date.now() + 1800_000).toISOString() } });
    expect(created.status).toBe(200);
    const leadId = (created.json.lead as { id: string }).id;
    const fromConv = await call(leadFromSource, { token, workspace: ws.slug, body: { conversationId: (await prisma.conversation.findFirst({ where: { psid: "PSID1" } }))!.id } });
    expect(fromConv.status).toBe(200);
    await call(leadsPost, { token, workspace: ws.slug, body: { contact: { name: "Private Lead" }, title: "Owner only", assignedToId: owner.id } });
    const supportView = await call(leadsGet, { token: supportToken, workspace: ws.slug });
    expect(supportView.json.total).toBe(2); // only leads assigned to the support agent (manual + from the conversation they own)
    const ownerView = await call(leadsGet, { token, workspace: ws.slug });
    expect(ownerView.json.total).toBe(3);
    expect((ownerView.json.pipeline as { status: string; count: number }[]).find((p) => p.status === "NEW")?.count).toBe(3);
    const moved = await call(leadPatch, { token: supportToken, workspace: ws.slug, method: "PATCH", params: { id: leadId }, body: { status: "QUALIFIED" } });
    expect(moved.status).toBe(200);
    const detail = await call(leadGet, { token, workspace: ws.slug, params: { id: leadId } });
    expect((detail.json.activities as { type: string }[]).some((a) => a.type === "STATUS_CHANGE")).toBe(true);
    const reminders = await sendFollowUpReminders();
    expect(reminders.reminded).toBe(1);
    expect(await prisma.notification.count({ where: { userId: supportUser.id, type: "FOLLOW_UP_DUE" } })).toBe(1);
    expect((await call(leadsExport, { token: supportToken, workspace: ws.slug })).status).toBe(403);
    const csv = await call(leadsExport, { token, workspace: ws.slug });
    expect(csv.status).toBe(200);
    expect(String(csv.json)).toContain("Rahim Uddin");
  });

  it("agents: versioned configuration, playground test, evaluation with metrics", async () => {
    const a = await call(agentsPost, { token, workspace: ws.slug, body: { name: "Moderator", purpose: "MODERATION", activate: true, version: { instructions: "Classify comments for an overseas employment agency.", languages: ["bn", "en"], tone: "neutral", provider: "openai", model: "gpt-4.1-mini", temperature: 0.1 } } });
    expect(a.status).toBe(200);
    const agentId = (a.json.agent as { id: string }).id;
    const badModel = await call(versionsPost, { token, workspace: ws.slug, params: { id: agentId }, body: { instructions: "x".repeat(20), languages: ["bn"], tone: "neutral", provider: "gemini", model: "gpt-4.1-mini", temperature: 0.2 } });
    expect(badModel.status).toBe(400);
    const v2 = await call(versionsPost, { token, workspace: ws.slug, params: { id: agentId }, body: { instructions: "Stricter instructions for spam.", languages: ["bn"], tone: "neutral", provider: "openai", model: "gpt-4.1-mini", temperature: 0.1, activate: true, changeNote: "tighten spam" } });
    expect((v2.json.version as { version: number }).version).toBe(2);
    expect((await call(agentsGet, { token, workspace: ws.slug })).json.agents).toHaveLength(1);
    const t = await call(testPost, { token, workspace: ws.slug, params: { id: agentId }, body: { text: "inbox me for visa www.scam.xyz" } });
    expect(t.status).toBe(200);
    expect((t.json.result as { category: string }).category).toBe("SPAM");
    expect(mock.graphCalls).toHaveLength(0);

    const examples = [
      { text: "আপনাদের সার্ভিস সম্পর্কে বিস্তারিত জানতে চাই।", category: "INQUIRY", expectedDecision: "REPLY" },
      { text: "আপনাদের সার্ভিস নিয়ে আমি সন্তুষ্ট নই।", category: "COMPLAINT", expectedDecision: "REVIEW" },
      { text: "100% guaranteed visa inbox me now www.scam.xyz", category: "SCAM", expectedDecision: "HIDE" },
      { text: "tui ekta ***, tor baap ***", category: "ABUSE", expectedDecision: "HIDE" },
      { text: "Alhamdulillah, apnader maddhome amar bhai Saudi gese. Thank you", category: "POSITIVE", expectedDecision: "REPLY" },
      { text: "Malaysia te kaj er beton koto?", category: "SALES_INQUIRY", expectedDecision: "REPLY" },
    ];
    const ex = await call(examplesPost, { token, workspace: ws.slug, body: { examples: examples.map((e) => ({ ...e, language: "bn" })) } });
    expect(ex.json.created).toBe(6);
    mock.aiResponse = () => (text: string) => {
      const hit = examples.find((e) => text.includes(e.text));
      const cat = hit?.category ?? "UNCERTAIN";
      const act = cat === "SCAM" || cat === "ABUSE" ? "HIDE" : cat === "COMPLAINT" ? "REVIEW" : "REPLY";
      return { language: "bn", category: cat === "ABUSE" ? "HARASSMENT" : cat, sentiment: "neutral", confidence: 0.9, risk_score: 0.5, reasoning: "mock", recommended_action: act, suggested_reply: act === "REPLY" ? "ok" : null };
    };
    const ev = await call(evalPost, { token, workspace: ws.slug, params: { id: agentId }, body: {} });
    expect(ev.status).toBe(200);
    const metrics = (await runEvaluation((ev.json.evaluation as { id: string }).id)) as { accuracy: number; hide: { falsePositiveRate: number }; complaintPreserved: number };
    expect(metrics.accuracy).toBeCloseTo(5 / 6, 2);
    expect(metrics.complaintPreserved).toBe(1);
    expect(metrics.hide.falsePositiveRate).toBe(0);
    const stats = await call(trainingStats, { token, workspace: ws.slug });
    expect(stats.json.examples).toBe(6);
    expect(stats.json.latestAccuracy).toBeCloseTo(5 / 6, 2);
    expect(await prisma.aiUsage.count({ where: { workspaceId: ws.id, purpose: "EVAL" } })).toBe(6);
  });

  it("BYOK keys are verified before storing, encrypted at rest, and only last4 is exposed", async () => {
    const r = await call(credPost, { token, workspace: ws.slug, body: { provider: "deepseek", apiKey: "sk-byok-secret-key-abcdef123456", label: "Team key" } });
    expect(r.status).toBe(200);
    expect((r.json.credential as { keyLast4: string }).keyLast4).toBe("3456");
    const row = await prisma.aiCredential.findFirst({ where: { workspaceId: ws.id } });
    expect(row?.keyEnc).not.toContain("sk-byok");
    const sw = await call(credPatch, { token, workspace: ws.slug, method: "PATCH", body: { mode: "BYOK", provider: "deepseek" } });
    expect(sw.status).toBe(200);
    mock.aiCalls = 0;
    const agent = await prisma.agent.findFirstOrThrow({ where: { workspaceId: ws.id } });
    // An agent pinned to openai cannot run on a deepseek-only BYOK workspace — and must not fall back silently.
    const blocked = await call(testPost, { token, workspace: ws.slug, params: { id: agent.id }, body: { text: "hello" } });
    expect(blocked.status).toBe(503);
    expect(mock.aiCalls).toBe(0);
    await call(versionsPost, { token, workspace: ws.slug, params: { id: agent.id }, body: { instructions: "Use deepseek for classification.", languages: ["bn"], tone: "neutral", provider: "deepseek", model: "deepseek-chat", temperature: 0.1, activate: true } });
    const t = await call(testPost, { token, workspace: ws.slug, params: { id: agent.id }, body: { text: "hello" } });
    expect(t.status).toBe(200);
    expect(await prisma.aiUsage.count({ where: { workspaceId: ws.id, credentialMode: "BYOK", provider: "deepseek" } })).toBe(1);
    // support agent cannot manage keys
    expect((await call(credPost, { token: supportToken, workspace: ws.slug, body: { provider: "openai", apiKey: "sk-whatever-1234567890" } })).status).toBe(403);
  });
});
