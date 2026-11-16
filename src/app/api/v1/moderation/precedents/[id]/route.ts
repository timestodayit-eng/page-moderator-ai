import { z } from "zod";
import { api } from "@/server/http";
import { deletePrecedent, updatePrecedent } from "@/server/moderation/precedents";

const schema = z.object({ status: z.enum(["ACTIVE", "DISABLED"]).optional(), decision: z.enum(["HIDE", "KEEP"]).optional(), note: z.string().max(300).optional(), scope: z.enum(["PAGE", "WORKSPACE"]).optional() });
export const PATCH = api({ permission: "moderation.approve", body: schema }, async ({ ws, params, body, ip }) => ({ precedent: await updatePrecedent(ws!, params.id, body, { ip }) }));
export const DELETE = api({ permission: "moderation.approve" }, async ({ ws, params, ip }) => {
  await deletePrecedent(ws!, params.id, { ip });
  return { ok: true };
});
