import { z } from "zod";
import { api } from "@/server/http";
import { revokeInvitation } from "@/server/platform/team";

export const DELETE = api({ permission: "team.manage", body: z.object({ invitationId: z.string().min(1) }) }, async ({ ws, body, ip }) => {
  await revokeInvitation(ws!, body.invitationId, { ip });
  return { ok: true };
});
