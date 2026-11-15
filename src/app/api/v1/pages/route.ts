import { api } from "@/server/http";
import { listPages } from "@/server/meta/pages";
import { isMetaConfigured } from "@/server/env";

export const GET = api({ permission: "dashboard.view" }, async ({ ws }) => ({ pages: await listPages(ws!.workspace.id), metaConfigured: isMetaConfigured() }));
