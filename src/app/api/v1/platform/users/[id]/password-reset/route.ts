import { api } from "@/server/http";
import { adminTriggerPasswordReset } from "@/server/platform/admin";

export const POST = api({ auth: "platform" }, async ({ user, params, ip }) => {
  await adminTriggerPasswordReset(user!.id, params.id, { ip });
  return { ok: true };
});
