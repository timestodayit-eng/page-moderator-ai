import { z } from "zod";
import { api } from "@/server/http";
import { conversationDetail, updateConversation } from "@/server/inbox/service";

export const GET = api({ permission: "inbox.manage" }, async ({ ws, params }) => conversationDetail(ws!, params.id));

export const PATCH = api({ permission: "inbox.manage", body: z.object({ status: z.enum(["NEW", "OPEN", "ASSIGNED", "PENDING", "RESOLVED", "CLOSED"]).optional(), assignedToId: z.string().nullable().optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), tags: z.array(z.string().max(30)).max(20).optional(), aiMode: z.enum(["OFF", "SUGGEST", "AUTO"]).optional() }) }, async ({ ws, params, body, ip }) => {
  await updateConversation(ws!, params.id, body, { ip });
  return { ok: true };
});
