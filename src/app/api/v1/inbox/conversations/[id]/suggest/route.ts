import { api } from "@/server/http";
import { suggestReply } from "@/server/inbox/service";

export const POST = api({ permission: "inbox.reply", rateLimit: { name: "inbox-suggest", limit: 120, windowSec: 3600, by: "user" } }, async ({ ws, params }) => suggestReply(ws!, params.id));
