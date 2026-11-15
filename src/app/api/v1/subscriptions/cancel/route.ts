import { z } from "zod";
import { api } from "@/server/http";
import { cancelSubscription } from "@/server/billing/lifecycle";

export const POST = api({ permission: "billing.manage", body: z.object({ cancel: z.boolean().default(true) }) }, async ({ ws, body }) => {
  await cancelSubscription(ws!.workspace.id, ws!.user.id, body.cancel);
  return { ok: true };
});
