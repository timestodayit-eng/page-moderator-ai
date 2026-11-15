import { z } from "zod";
import { api } from "@/server/http";
import { requestPasswordReset } from "@/server/auth/service";

export const POST = api({ auth: "none", body: z.object({ email: z.email().max(200) }) }, async ({ body, ip, userAgent }) => {
  await requestPasswordReset(body.email, { ip, userAgent });
  // Identical response whether or not the account exists.
  return { ok: true, message: "If an account exists for this email, a reset link has been sent." };
});
