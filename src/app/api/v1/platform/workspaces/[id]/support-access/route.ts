import { z } from "zod";
import { api } from "@/server/http";
import { requestSupportAccess } from "@/server/platform/admin";

export const POST = api({ auth: "platform-support", body: z.object({ reason: z.string().trim().min(5).max(500), scope: z.enum(["inbox:read", "inbox:write"]).default("inbox:read") }) }, async ({ user, params, body, ip }) => {
  const g = await requestSupportAccess(user!.id, params.id, body.reason, body.scope, { ip });
  return { grant: { id: g.id, status: g.status } };
});
