import { api } from "@/server/http";
import { listPages } from "@/server/meta/pages";
import { isMetaConfigured } from "@/server/env";
import { pageScope } from "@/server/rbac/guard";

export const GET = api({ permission: "dashboard.view" }, async ({ ws }) => ({ pages: await listPages(ws!.workspace.id, pageScope(ws!)), metaConfigured: isMetaConfigured() }));
