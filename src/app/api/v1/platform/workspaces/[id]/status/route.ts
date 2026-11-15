import { z } from "zod";
import { api } from "@/server/http";
import { setWorkspaceStatus } from "@/server/platform/admin";

export const POST = api({ auth: "platform", body: z.object({ status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "CLOSED"]), reason: z.string().max(500).default("") }) }, async ({ user, params, body, ip }) => {
  await setWorkspaceStatus(user!.id, params.id, body.status, body.reason, { ip });
  return { ok: true };
});
