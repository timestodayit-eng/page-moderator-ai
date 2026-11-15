import { z } from "zod";
import { api } from "@/server/http";
import { updatePageConfig } from "@/server/meta/pages";

const schema = z.object({
  moderationMode: z.enum(["SHADOW", "APPROVAL", "AUTO"]).optional(),
  autoHideEnabled: z.boolean().optional(),
  killSwitch: z.boolean().optional(),
  replyMode: z.enum(["OFF", "SUGGEST", "APPROVAL", "LIMITED_AUTO"]).optional(),
  moderationAgentId: z.string().nullable().optional(),
  replyAgentId: z.string().nullable().optional(),
  messengerAgentId: z.string().nullable().optional(),
  settings: z.unknown().optional(),
});
export const PATCH = api({ permission: "pages.manage", body: schema }, async ({ ws, params, body, ip }) => {
  await updatePageConfig(ws!, params.id, body, { ip });
  return { ok: true };
});
