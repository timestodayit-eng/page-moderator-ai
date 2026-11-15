import { api, paginate } from "@/server/http";
import { listAuditLogs } from "@/server/platform/admin";

export const GET = api({ permission: "audit.view" }, async ({ req, ws }) => {
  const { skip, take, page, pageSize } = paginate(req, { pageSize: 50 });
  const sp = req.nextUrl.searchParams;
  return { ...(await listAuditLogs({ workspaceId: ws!.workspace.id, action: sp.get("action") ?? undefined, actorUserId: sp.get("actorUserId") ?? undefined, skip, take })), page, pageSize };
});
