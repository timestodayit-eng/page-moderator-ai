import type { ConversationStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "../db";
import { Errors } from "../errors";
import { audit } from "../audit";
import { pageScope, type WorkspaceContext } from "../rbac/guard";
import { requestAction } from "../actions/outbound";
import { complete } from "../ai/gateway";
import { retrieveKnowledge } from "../agents/knowledge";
import { loadActiveAgent } from "../agents/service";

const REPLY_LOCK_MS = 60_000;
const MESSAGING_WINDOW_MS = 24 * 3_600_000;
type Meta = { ip?: string | null };

const LIFECYCLE: Record<ConversationStatus, ConversationStatus[]> = {
  NEW: ["OPEN", "ASSIGNED", "CLOSED"],
  OPEN: ["ASSIGNED", "PENDING", "RESOLVED", "CLOSED"],
  ASSIGNED: ["OPEN", "PENDING", "RESOLVED", "CLOSED"],
  PENDING: ["OPEN", "ASSIGNED", "RESOLVED", "CLOSED"],
  RESOLVED: ["OPEN", "CLOSED"],
  CLOSED: ["OPEN"],
};

function scope(ctx: WorkspaceContext): Prisma.ConversationWhereInput {
  const pages = pageScope(ctx);
  const base: Prisma.ConversationWhereInput = { workspaceId: ctx.workspace.id, ...(pages ? { pageId: pages } : {}) };
  return ctx.permissions.has("inbox.all") ? base : { ...base, OR: [{ assignedToId: ctx.user.id }, { assignedToId: null, status: { in: ["NEW", "OPEN"] } }] };
}

export async function listConversations(ctx: WorkspaceContext, q: { status?: string; pageId?: string; assigned?: "me" | "unassigned" | string; tag?: string; priority?: string; search?: string; unread?: boolean; skip: number; take: number }) {
  const where: Prisma.ConversationWhereInput = {
    AND: [
      scope(ctx),
      q.status ? { status: q.status as ConversationStatus } : {},
      q.pageId ? { pageId: q.pageId } : {},
      q.assigned === "me" ? { assignedToId: ctx.user.id } : q.assigned === "unassigned" ? { assignedToId: null } : q.assigned ? { assignedToId: q.assigned } : {},
      q.tag ? { tags: { has: q.tag } } : {},
      q.priority ? { priority: q.priority } : {},
      q.unread ? { unreadCount: { gt: 0 } } : {},
      q.search ? { OR: [{ contact: { name: { contains: q.search, mode: "insensitive" } } }, { contact: { phone: { contains: q.search } } }, { messages: { some: { text: { contains: q.search, mode: "insensitive" } } } }] } : {},
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.conversation.count({ where }),
    prisma.conversation.findMany({ where, skip: q.skip, take: q.take, orderBy: { lastMessageAt: "desc" }, include: { contact: { select: { id: true, name: true, phone: true, tags: true } }, page: { select: { id: true, name: true } }, assignedTo: { select: { id: true, name: true } } } }),
  ]);
  const counts = await prisma.conversation.groupBy({ by: ["status"], _count: true, where: scope(ctx) });
  return { total, rows, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) };
}

export async function conversationDetail(ctx: WorkspaceContext, id: string) {
  const conv = await prisma.conversation.findFirst({ where: { AND: [scope(ctx), { id }] }, include: { contact: { include: { leads: { orderBy: { createdAt: "desc" }, take: 5 } } }, page: { select: { id: true, name: true, status: true } }, assignedTo: { select: { id: true, name: true } }, notes: { orderBy: { createdAt: "desc" }, take: 50 } } });
  if (!conv) throw Errors.notFound("Conversation");
  const messages = await prisma.message.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" }, take: 200 });
  const authors = await prisma.user.findMany({ where: { id: { in: [...new Set([...messages.map((m) => m.sentById), ...conv.notes.map((n) => n.authorId)].filter(Boolean))] as string[] } }, select: { id: true, name: true } });
  if (conv.unreadCount > 0) await prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } });
  const windowOpen = conv.lastInboundAt ? Date.now() - conv.lastInboundAt.getTime() < MESSAGING_WINDOW_MS : false;
  return { ...conv, messages, authors: Object.fromEntries(authors.map((a) => [a.id, a.name])), messagingWindowOpen: windowOpen, replyLocked: conv.replyLockUntil && conv.replyLockUntil > new Date() ? conv.replyLockById : null };
}

export async function updateConversation(ctx: WorkspaceContext, id: string, patch: { status?: ConversationStatus; assignedToId?: string | null; priority?: string; tags?: string[]; aiMode?: "OFF" | "SUGGEST" | "AUTO" }, meta: Meta) {
  const conv = await prisma.conversation.findFirst({ where: { AND: [scope(ctx), { id }] } });
  if (!conv) throw Errors.notFound("Conversation");
  const data: Prisma.ConversationUpdateInput = {};
  if (patch.status && patch.status !== conv.status) {
    if (!LIFECYCLE[conv.status].includes(patch.status)) throw Errors.badRequest(`Cannot move conversation from ${conv.status} to ${patch.status}`);
    data.status = patch.status;
  }
  if (patch.assignedToId !== undefined) {
    if (patch.assignedToId) {
      const m = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: patch.assignedToId, workspaceId: ctx.workspace.id } } });
      if (!m || m.status !== "ACTIVE") throw Errors.badRequest("Assignee is not an active member");
      data.assignedTo = { connect: { id: patch.assignedToId } };
      if (!patch.status && (conv.status === "NEW" || conv.status === "OPEN")) data.status = "ASSIGNED";
    } else {
      data.assignedTo = { disconnect: true };
      if (!patch.status && conv.status === "ASSIGNED") data.status = "OPEN";
    }
  }
  if (patch.priority) data.priority = patch.priority;
  if (patch.tags) data.tags = patch.tags.map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20);
  if (patch.aiMode) {
    if (patch.aiMode === "AUTO" && !ctx.permissions.has("pages.automation")) throw Errors.forbidden("Missing permission: pages.automation");
    data.aiMode = patch.aiMode;
  }
  await prisma.$transaction(async (tx) => {
    await tx.conversation.update({ where: { id }, data });
    await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "conversation.updated", targetType: "Conversation", targetId: id, ip: meta.ip, meta: { patch } }, tx);
  });
}

/** Human takeover: pauses AI auto replies for this conversation and claims the reply lock. */
export async function takeover(ctx: WorkspaceContext, id: string) {
  const conv = await prisma.conversation.findFirst({ where: { AND: [scope(ctx), { id }] } });
  if (!conv) throw Errors.notFound("Conversation");
  await prisma.conversation.update({ where: { id }, data: { aiMode: conv.aiMode === "AUTO" ? "SUGGEST" : conv.aiMode, humanTakeoverAt: new Date(), humanTakeoverById: ctx.user.id, assignedToId: conv.assignedToId ?? ctx.user.id, status: conv.status === "NEW" || conv.status === "OPEN" ? "ASSIGNED" : conv.status } });
}

/**
 * Send a reply. A short-lived reply lock (single conditional UPDATE) prevents two agents — or an agent and
 * the AI — from replying simultaneously. Respects the 24h standard messaging window unless a tag is supplied.
 */
export async function sendReply(ctx: WorkspaceContext, id: string, input: { text: string; tag?: "HUMAN_AGENT" | "CONFIRMED_EVENT_UPDATE" | "POST_PURCHASE_UPDATE" | "ACCOUNT_UPDATE"; senderType?: "AGENT" | "AI" }, meta: Meta) {
  const text = input.text.trim();
  if (!text) throw Errors.badRequest("Message cannot be empty");
  if (text.length > 2000) throw Errors.badRequest("Message is too long (max 2000 characters)");
  const conv = await prisma.conversation.findFirst({ where: { AND: [scope(ctx), { id }] }, include: { page: true } });
  if (!conv) throw Errors.notFound("Conversation");
  if (conv.page.status !== "CONNECTED") throw Errors.conflict("Page is not connected");
  if (!conv.page.grantedScopes.includes("pages_messaging")) throw Errors.conflict("This Page was connected without the pages_messaging permission. Reconnect the Page to enable Messenger replies.");
  const withinWindow = conv.lastInboundAt && Date.now() - conv.lastInboundAt.getTime() < MESSAGING_WINDOW_MS;
  if (!withinWindow && !input.tag) throw Errors.conflict("The 24-hour messaging window has closed. A message tag is required (e.g. HUMAN_AGENT within 7 days) per Meta policy.");
  if (!conv.lastInboundAt) throw Errors.forbidden("Cannot start an unsolicited Messenger conversation");

  const locked = await prisma.$executeRaw`UPDATE "Conversation" SET "replyLockById" = ${ctx.user.id}, "replyLockUntil" = (NOW() AT TIME ZONE 'UTC') + (${REPLY_LOCK_MS} || ' milliseconds')::interval WHERE "id" = ${id} AND ("replyLockUntil" IS NULL OR "replyLockUntil" < (NOW() AT TIME ZONE 'UTC') OR "replyLockById" = ${ctx.user.id})`;
  if (locked === 0) throw Errors.conflict("Another team member is replying to this conversation right now");
  try {
    return await prisma.$transaction(async (tx) => {
      const { action } = await requestAction({ workspaceId: ctx.workspace.id, pageId: conv.pageId, type: "SEND_MESSAGE", targetId: conv.psid, idempotencyKey: `msg:${id}:${ctx.user.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, payload: { psid: conv.psid, text, tag: input.tag }, createdById: ctx.user.id }, tx);
      const msg = await tx.message.create({ data: { workspaceId: ctx.workspace.id, conversationId: id, direction: "OUT", text, senderType: input.senderType ?? "AGENT", sentById: ctx.user.id, status: "QUEUED", outboundActionId: action.id } });
      await tx.conversation.update({ where: { id }, data: { lastMessageAt: new Date(), lastPreview: text.slice(0, 140), status: conv.status === "NEW" || conv.status === "OPEN" ? "ASSIGNED" : conv.status, assignedToId: conv.assignedToId ?? ctx.user.id, humanTakeoverAt: conv.humanTakeoverAt ?? new Date(), aiMode: conv.aiMode === "AUTO" ? "SUGGEST" : conv.aiMode } });
      await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "conversation.reply_sent", targetType: "Conversation", targetId: id, ip: meta.ip }, tx);
      return { messageId: msg.id, actionId: action.id };
    });
  } finally {
    await prisma.conversation.updateMany({ where: { id, replyLockById: ctx.user.id }, data: { replyLockById: null, replyLockUntil: null } });
  }
}

export async function addNote(ctx: WorkspaceContext, id: string, body: string) {
  const conv = await prisma.conversation.findFirst({ where: { AND: [scope(ctx), { id }] } });
  if (!conv) throw Errors.notFound("Conversation");
  return prisma.conversationNote.create({ data: { workspaceId: ctx.workspace.id, conversationId: id, authorId: ctx.user.id, body: body.trim().slice(0, 4000) } });
}

/** AI reply suggestion for the inbox (never sent automatically here). */
export async function suggestReply(ctx: WorkspaceContext, id: string) {
  const conv = await prisma.conversation.findFirst({ where: { AND: [scope(ctx), { id }] }, include: { page: true, contact: true } });
  if (!conv) throw Errors.notFound("Conversation");
  const messages = await prisma.message.findMany({ where: { conversationId: id }, orderBy: { createdAt: "desc" }, take: 12 });
  const agent = await loadActiveAgent(ctx.workspace.id, conv.page.messengerAgentId, "MESSENGER");
  const lastCustomer = messages.find((m) => m.direction === "IN")?.text ?? "";
  const knowledge = await retrieveKnowledge(ctx.workspace.id, lastCustomer, { sourceIds: agent?.knowledgeSourceIds, limit: 5 });
  const transcript = messages.reverse().map((m) => `${m.direction === "IN" ? "Customer" : "Business"}: ${m.text}`).join("\n");
  const sys = [
    `You are the Messenger assistant for ${ctx.workspace.name}. Draft the next reply from the business. Match the customer's language and script (Bengali / Banglish / English). Be warm, concise (max 3 sentences), honest. Use ONLY the approved knowledge below for facts; if missing, offer the official contact. Never invent prices, salaries, dates or guarantees. If the customer is upset or asks for a human, say a team member will follow up.`,
    agent?.instructions ? `Instructions: ${agent.instructions}` : "",
    agent?.tone ? `Tone: ${agent.tone}` : "",
    knowledge.length ? `Approved knowledge:\n${knowledge.map((k, i) => `[${i + 1}] ${k.content}`).join("\n")}` : "No approved knowledge available.",
    `Return JSON: {"reply": string, "confidence": number 0-1, "escalate": boolean, "reason": string}`,
  ].filter(Boolean).join("\n\n");
  const res = await complete({ workspaceId: ctx.workspace.id, purpose: "MESSENGER", provider: agent?.provider, credentialId: agent?.credentialId, model: agent?.model, temperature: agent?.temperature ?? 0.4, json: true, maxTokens: 500, agentId: agent?.id, agentVersionId: agent?.versionId, ref: { type: "Conversation", id }, messages: [{ role: "system", content: sys }, { role: "user", content: `Conversation so far:\n${transcript}\n\nDraft the business's next reply.` }] });
  const { parseJsonObject } = await import("../ai/gateway");
  const out = parseJsonObject<{ reply: string; confidence: number; escalate: boolean; reason: string }>(res.text);
  return { ...out, model: res.model, provider: res.provider, knowledgeUsed: knowledge.length };
}

export async function savedReplies(workspaceId: string) {
  return prisma.savedReply.findMany({ where: { workspaceId }, orderBy: { title: "asc" } });
}
