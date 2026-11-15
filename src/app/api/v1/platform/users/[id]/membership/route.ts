import { z } from "zod";
import { api } from "@/server/http";
import { adminSetMembership } from "@/server/platform/admin";

export const POST = api({ auth: "platform", body: z.object({ workspaceId: z.string(), roleKey: z.string().nullable() }) }, async ({ user, params, body, ip }) => {
  await adminSetMembership(user!.id, { userId: params.id, ...body }, { ip });
  return { ok: true };
});
