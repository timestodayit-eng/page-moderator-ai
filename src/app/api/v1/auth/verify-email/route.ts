import { z } from "zod";
import { api } from "@/server/http";
import { verifyEmail } from "@/server/auth/service";

export const POST = api({ auth: "none", body: z.object({ token: z.string().min(20).max(200) }), rateLimit: { name: "verify", limit: 20, windowSec: 900 } }, async ({ body }) => {
  await verifyEmail(body.token);
  return { ok: true };
});
