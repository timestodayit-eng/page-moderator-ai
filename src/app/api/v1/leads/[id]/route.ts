import { z } from "zod";
import { api } from "@/server/http";
import { leadDetail, updateLead } from "@/server/crm/service";

export const GET = api({ permission: "crm.access" }, async ({ ws, params }) => leadDetail(ws!, params.id));

export const PATCH = api({ permission: "crm.access", body: z.object({ title: z.string().trim().min(1).max(160).optional(), status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "FOLLOW_UP", "CONVERTED", "LOST"]).optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), tags: z.array(z.string().max(30)).max(20).optional(), assignedToId: z.string().nullable().optional(), followUpAt: z.iso.datetime().nullable().optional(), notes: z.string().max(4000).optional(), valueCents: z.number().int().nonnegative().nullable().optional(), lostReason: z.string().max(300).optional() }) }, async ({ ws, params, body, ip }) => {
  await updateLead(ws!, params.id, { ...body, followUpAt: body.followUpAt === undefined ? undefined : body.followUpAt ? new Date(body.followUpAt) : null }, { ip });
  return { ok: true };
});
