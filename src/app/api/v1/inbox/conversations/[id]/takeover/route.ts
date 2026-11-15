import { api } from "@/server/http";
import { takeover } from "@/server/inbox/service";

export const POST = api({ permission: "inbox.reply" }, async ({ ws, params }) => {
  await takeover(ws!, params.id);
  return { ok: true };
});
