import { api } from "@/server/http";
import { listUserWorkspaces } from "@/server/platform/workspaces";

export const GET = api({}, async ({ user }) => {
  const workspaces = await listUserWorkspaces(user!.id);
  return { user: { id: user!.id, email: user!.email, name: user!.name, platformRole: user!.platformRole, locale: user!.locale, emailVerified: Boolean(user!.emailVerifiedAt), mfaEnabled: user!.mfaEnabled }, workspaces };
});
