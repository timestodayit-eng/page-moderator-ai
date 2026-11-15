import { z } from "zod";
import { api } from "@/server/http";
import { retryDelivery } from "@/server/platform/admin";

export const POST = api({ auth: "platform", body: z.object({ deliveryId: z.string() }) }, async ({ user, body }) => {
  await retryDelivery(user!.id, body.deliveryId);
  return { ok: true };
});
