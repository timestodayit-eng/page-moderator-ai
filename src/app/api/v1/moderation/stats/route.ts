import { api } from "@/server/http";
import { moderationStats } from "@/server/moderation/review";
import { pageScope } from "@/server/rbac/guard";

export const GET = api({ permission: "comments.read" }, async ({ req, ws }) => moderationStats(ws!.workspace.id, req.nextUrl.searchParams.get("pageId") ?? undefined, Number(req.nextUrl.searchParams.get("days") ?? 30) || 30, pageScope(ws!)));
