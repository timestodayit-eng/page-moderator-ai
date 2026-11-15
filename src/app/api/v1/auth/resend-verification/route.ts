import { api } from "@/server/http";
import { resendVerification } from "@/server/auth/service";

export const POST = api({}, async ({ user }) => {
  await resendVerification(user!.id);
  return { ok: true };
});
