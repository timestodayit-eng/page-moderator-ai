import { z } from "zod";
import { api, paginate } from "@/server/http";
import { createPrecedent, listPrecedents } from "@/server/moderation/precedents";

export const GET = api({ permission: "comments.read" }, async ({ req, ws }) => {
  const { skip, take, page, pageSize } = paginate(req, { pageSize: 30 });
  const sp = req.nextUrl.searchParams;
  const data = await listPrecedents(ws!, { pageId: sp.get("pageId") ?? undefined, status: sp.get("status") ?? undefined, decision: sp.get("decision") ?? undefined, search: sp.get("search") ?? undefined, skip, take });
  return { ...data, page, pageSize };
});

const schema = z.object({ commentId: z.string().min(1), decision: z.enum(["HIDE", "KEEP"]), scope: z.enum(["PAGE", "WORKSPACE"]).default("PAGE"), category: z.string().optional(), note: z.string().max(300).optional() });
export const POST = api({ permission: "moderation.approve", body: schema }, async ({ ws, body, ip }) => ({ precedent: await createPrecedent(ws!, body, { ip }) }));
