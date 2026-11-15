import { z } from "zod";
import { api } from "@/server/http";
import { changePassword } from "@/server/auth/service";

export const POST = api({ body: z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(10).max(200) }) }, async ({ body, user, sessionId, ip, userAgent }) => {
  await changePassword(user!.id, body.currentPassword, body.newPassword, sessionId!, { ip, userAgent });
  return { ok: true };
});
