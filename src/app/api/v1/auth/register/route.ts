import { z } from "zod";
import { api } from "@/server/http";
import { register } from "@/server/auth/service";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().max(200),
  password: z.string().min(10).max(200),
  businessName: z.string().trim().min(2).max(120).optional(),
  locale: z.enum(["en", "bn"]).optional(),
});

export const POST = api({ auth: "none", body: schema, rateLimit: { name: "register", limit: 5, windowSec: 3600 } }, async ({ body, ip, userAgent }) => {
  return register(body, { ip, userAgent });
});
