import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { sendReply } from "@/server/inbox/service";

export const GET = api({ permission: "inbox.manage" }, async ({ req, ws, params }) => {
  const before = req.nextUrl.searchParams.get("before");
  const conv = await prisma.conversation.findFirst({ where: { id: params.id, workspaceId: ws!.workspace.id }, select: { id: true } });
  if (!conv) return { messages: [] };
  const messages = await prisma.message.findMany({ where: { conversationId: params.id, ...(before ? { createdAt: { lt: new Date(before) } } : {}) }, orderBy: { createdAt: "desc" }, take: 50 });
  return { messages: messages.reverse() };
});

export const POST = api({ permission: "inbox.reply", body: z.object({ text: z.string().min(1).max(2000), tag: z.enum(["HUMAN_AGENT", "CONFIRMED_EVENT_UPDATE", "POST_PURCHASE_UPDATE", "ACCOUNT_UPDATE"]).optional() }) }, async ({ ws, params, body, ip }) => sendReply(ws!, params.id, body, { ip }));
