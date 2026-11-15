import { api, paginate } from "@/server/http";
import { listDeliveries } from "@/server/platform/admin";

export const GET = api({ auth: "platform" }, async ({ req }) => {
  const { skip, take, page, pageSize } = paginate(req, { pageSize: 50 });
  const sp = req.nextUrl.searchParams;
  const data = await listDeliveries({ status: sp.get("status") ?? undefined, workspaceId: sp.get("workspaceId") ?? undefined, search: sp.get("search") ?? undefined, campaignId: sp.get("campaignId") ?? undefined, skip, take });
  return { ...data, page, pageSize };
});
