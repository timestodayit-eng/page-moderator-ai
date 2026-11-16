import { api, json } from "@/server/http";
import { commentDetail } from "@/server/moderation/review";
import { pageScope } from "@/server/rbac/guard";

export const GET = api({ permission: "comments.read" }, async ({ ws, params }) => json(await commentDetail(ws!.workspace.id, params.id, pageScope(ws!))));
