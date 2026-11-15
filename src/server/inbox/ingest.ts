import type { ConnectedPage } from "@/generated/prisma/client";
import { prisma } from "../db";
import { log } from "../log";
import { graph } from "../meta/graph";
import { pageToken } from "../meta/pages";
import { enqueueOutbox } from "../queue/outbox";

type MessagingEvent = { sender: { id: string }; recipient: { id: string }; timestamp: number; message?: { mid: string; text?: string; attachments?: { type: string; payload?: { url?: string } }[]; is_echo?: boolean }; postback?: { payload: string; title?: string }; read?: { watermark: number } };

/** Store an inbound Messenger event as Contact + Conversation + Message. Idempotent on fbMessageId. */
export async function ingestMessagingEvent(page: ConnectedPage, ev: MessagingEvent) {
  if (ev.read) return { ignored: "read" };
  const isEcho = Boolean(ev.message?.is_echo);
  const psid = isEcho ? ev.recipient.id : ev.sender.id;
  if (!psid || psid === page.fbPageId) return { ignored: "self" };
  const text = ev.message?.text ?? (ev.postback ? `[${ev.postback.title ?? ev.postback.payload}]` : "");
  const mid = ev.message?.mid ?? `pb:${psid}:${ev.timestamp}`;
  if (await prisma.message.findUnique({ where: { fbMessageId: mid } })) return { duplicate: true };

  let contact = await prisma.contact.findUnique({ where: { workspaceId_fbPsid: { workspaceId: page.workspaceId, fbPsid: psid } } });
  if (!contact) {
    let name = "Facebook user";
    try {
      const p = await graph.userProfile(psid, await pageToken(page.id));
      name = p.name ?? ([p.first_name, p.last_name].filter(Boolean).join(" ") || name);
    } catch (err) {
      log.debug("profile lookup failed", { err: String(err) });
    }
    contact = await prisma.contact.create({ data: { workspaceId: page.workspaceId, fbPsid: psid, name, source: "MESSENGER" } });
  }
  const at = new Date(ev.timestamp || Date.now());
  const result = await prisma.$transaction(async (tx) => {
    const conv = await tx.conversation.upsert({
      where: { pageId_psid: { pageId: page.id, psid } },
      update: isEcho
        ? { lastMessageAt: at, lastPreview: text.slice(0, 140) }
        : { lastMessageAt: at, lastInboundAt: at, lastPreview: text.slice(0, 140), unreadCount: { increment: 1 }, status: undefined },
      create: { workspaceId: page.workspaceId, pageId: page.id, contactId: contact!.id, psid, status: "NEW", lastMessageAt: at, lastInboundAt: isEcho ? null : at, lastPreview: text.slice(0, 140), unreadCount: isEcho ? 0 : 1 },
    });
    // Resolved/closed conversations re-open on a new customer message.
    if (!isEcho && (conv.status === "RESOLVED" || conv.status === "CLOSED")) await tx.conversation.update({ where: { id: conv.id }, data: { status: conv.assignedToId ? "ASSIGNED" : "OPEN" } });
    const msg = await tx.message.create({
      data: { workspaceId: page.workspaceId, conversationId: conv.id, direction: isEcho ? "OUT" : "IN", fbMessageId: mid, text, attachments: (ev.message?.attachments ?? []) as object[], senderType: isEcho ? "AGENT" : "CUSTOMER", status: isEcho ? "SENT" : "RECEIVED", sentAt: isEcho ? at : null },
    });
    if (!isEcho && conv.aiMode !== "OFF") await enqueueOutbox("ai.suggest-reply", { conversationId: conv.id, messageId: msg.id }, tx);
    return { conversationId: conv.id, messageId: msg.id };
  });
  return result;
}
