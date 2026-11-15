import { z } from "zod";
import { api } from "@/server/http";
import { resetPassword } from "@/server/auth/service";

export const POST = api(
  { auth: "none", body: z.object({ token: z.string().min(20).max(200), password: z.string().min(10).max(200) }), rateLimit: { name: "pwreset-complete", limit: 10, windowSec: 900 } },
  async ({ body, ip, userAgent }) => {
    await resetPassword(body.token, body.password, { ip, userAgent });
    return { ok: true };
  },
);
