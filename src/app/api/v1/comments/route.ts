import { api, json, paginate } from "@/server/http";
import { listComments } from "@/server/moderation/review";

export const GET = api({ permission: "comments.read" }, async ({ req, ws }) => {
  const { skip, take, page, pageSize } = paginate(req);
  const sp = req.nextUrl.searchParams;
  const data = await listComments(ws!.workspace.id, {
    pageId: sp.get("pageId") ?? undefined, category: sp.get("category") ?? undefined, status: sp.get("status") ?? undefined,
    review: (sp.get("review") as "PENDING" | null) ?? undefined, hidden: sp.get("hidden") ? sp.get("hidden") === "true" : undefined,
    search: sp.get("search") ?? undefined, from: sp.get("from") ? new Date(sp.get("from")!) : undefined, to: sp.get("to") ? new Date(sp.get("to")!) : undefined, skip, take,
  });
  return json({ ...data, page, pageSize });
});
