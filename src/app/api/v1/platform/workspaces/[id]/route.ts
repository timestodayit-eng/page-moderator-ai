import { z } from "zod";
import { api, json } from "@/server/http";
import { updateWorkspaceAdmin, workspaceDetail } from "@/server/platform/admin";

export const GET = api({ auth: "platform-support" }, async ({ params }) => json(await workspaceDetail(params.id)));

const patch = z.object({ name: z.string().trim().min(2).max(120).optional(), type: z.enum(["INTERNAL", "CUSTOMER"]).optional(), billingExempt: z.boolean().optional(), servicesEnabled: z.record(z.string(), z.boolean()).optional(), emergencyPause: z.boolean().optional(), allowPlatformFallback: z.boolean().optional() });
export const PATCH = api({ auth: "platform", body: patch }, async ({ user, params, body, ip }) => {
  await updateWorkspaceAdmin(user!.id, params.id, body, { ip });
  return { ok: true };
});
