import { z } from "zod";
import { api } from "@/server/http";
import { SETTING_KEYS, getSettings, updateSetting } from "@/server/platform/admin";

export const GET = api({ auth: "platform" }, async () => ({ settings: await getSettings() }));

export const PUT = api({ auth: "platform", body: z.object({ key: z.enum(SETTING_KEYS), value: z.record(z.string(), z.unknown()) }) }, async ({ user, body, ip }) => {
  await updateSetting(user!.id, body.key, body.value, { ip });
  return { ok: true };
});
