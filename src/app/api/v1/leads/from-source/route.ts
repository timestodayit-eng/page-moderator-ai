import { z } from "zod";
import { api } from "@/server/http";
import { leadFromSource } from "@/server/crm/service";

export const POST = api({ permission: "crm.access", body: z.object({ commentId: z.string().optional(), conversationId: z.string().optional(), title: z.string().max(160).optional() }) }, async ({ ws, body, ip }) => ({ lead: await leadFromSource(ws!, body, { ip }) }));
