import { z } from "zod";
import { api } from "@/server/http";
import { adminUpdateUser, userDetail } from "@/server/platform/admin";

export const GET = api({ auth: "platform-support" }, async ({ params }) => userDetail(params.id));

export const PATCH = api({ auth: "platform", body: z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]).optional(), platformRole: z.enum(["NONE", "SUPPORT", "SUPER_ADMIN"]).optional(), name: z.string().trim().min(2).max(80).optional() }) }, async ({ user, params, body, ip }) => {
  await adminUpdateUser(user!.id, user!.platformRole, params.id, body, { ip });
  return { ok: true };
});
