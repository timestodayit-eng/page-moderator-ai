import { api, paginate } from "@/server/http";
import { listAuditLogs } from "@/server/platform/admin";

export const GET = api({ auth: "platform-support" }, async ({ req }) => {
  const { skip, take, page, pageSize } = paginate(req, { pageSize: 50 });
  const sp = req.nextUrl.searchParams;
  const data = await listAuditLogs({ workspaceId: sp.get("workspaceId") ?? undefined, actorUserId: sp.get("actorUserId") ?? undefined, action: sp.get("action") ?? undefined, from: sp.get("from") ? new Date(sp.get("from")!) : undefined, to: sp.get("to") ? new Date(sp.get("to")!) : undefined, skip, take });
  return { ...data, page, pageSize };
});
