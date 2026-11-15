import { api } from "@/server/http";
import { reanalyze } from "@/server/moderation/review";

export const POST = api({ permission: "moderation.approve" }, async ({ ws, params }) => {
  await reanalyze(ws!, params.id);
  return { ok: true };
});
