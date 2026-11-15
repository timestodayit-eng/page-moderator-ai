import { z } from "zod";
import { api, paginate } from "@/server/http";
import { createLead, listLeads } from "@/server/crm/service";

export const GET = api({ permission: "crm.access" }, async ({ req, ws }) => {
  const { skip, take, page, pageSize } = paginate(req, { pageSize: 50 });
  const sp = req.nextUrl.searchParams;
  const data = await listLeads(ws!, { status: sp.get("status") ?? undefined, assigned: sp.get("assigned") ?? undefined, source: sp.get("source") ?? undefined, tag: sp.get("tag") ?? undefined, priority: sp.get("priority") ?? undefined, search: sp.get("search") ?? undefined, dueBefore: sp.get("dueBefore") ? new Date(sp.get("dueBefore")!) : undefined, sort: sp.get("sort") ?? undefined, skip, take });
  return { ...data, page, pageSize };
});

export const POST = api({ permission: "crm.access", body: z.object({ contactId: z.string().optional(), contact: z.object({ name: z.string().trim().min(1).max(120), phone: z.string().max(30).optional(), email: z.email().optional().or(z.literal("")) }).optional(), title: z.string().trim().min(1).max(160), source: z.string().max(30).optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), tags: z.array(z.string().max(30)).max(20).optional(), assignedToId: z.string().nullable().optional(), followUpAt: z.iso.datetime().nullable().optional(), notes: z.string().max(4000).optional(), valueCents: z.number().int().nonnegative().optional() }) }, async ({ ws, body, ip }) => ({ lead: await createLead(ws!, { ...body, contact: body.contact ? { ...body.contact, email: body.contact.email || undefined } : undefined, followUpAt: body.followUpAt ? new Date(body.followUpAt) : null }, { ip }) }));
