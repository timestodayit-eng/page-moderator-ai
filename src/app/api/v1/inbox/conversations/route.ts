import { api, paginate } from "@/server/http";
import { listConversations } from "@/server/inbox/service";

export const GET = api({ permission: "inbox.manage" }, async ({ req, ws }) => {
  const { skip, take, page, pageSize } = paginate(req, { pageSize: 30 });
  const sp = req.nextUrl.searchParams;
  const data = await listConversations(ws!, { status: sp.get("status") ?? undefined, pageId: sp.get("pageId") ?? undefined, assigned: sp.get("assigned") ?? undefined, tag: sp.get("tag") ?? undefined, priority: sp.get("priority") ?? undefined, search: sp.get("search") ?? undefined, unread: sp.get("unread") === "true", skip, take });
  return { ...data, page, pageSize };
});
