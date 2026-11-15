import { z } from "zod";
import { api, paginate } from "@/server/http";
import { listContacts, upsertContact } from "@/server/crm/service";

export const GET = api({ permission: "crm.access" }, async ({ req, ws }) => {
  const { skip, take, page, pageSize } = paginate(req, { pageSize: 50 });
  const sp = req.nextUrl.searchParams;
  return { ...(await listContacts(ws!, { search: sp.get("search") ?? undefined, tag: sp.get("tag") ?? undefined, skip, take })), page, pageSize };
});
export const POST = api({ permission: "crm.access", body: z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(120), phone: z.string().max(30).nullable().optional(), email: z.email().nullable().optional().or(z.literal("")), tags: z.array(z.string().max(30)).max(20).optional(), notes: z.string().max(4000).nullable().optional() }) }, async ({ ws, body, ip }) => ({ contact: await upsertContact(ws!, { ...body, email: body.email || null }, { ip }) }));
