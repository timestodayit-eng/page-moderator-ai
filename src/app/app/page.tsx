import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth/current";
import { listUserWorkspaces } from "@/server/platform/workspaces";

export default async function AppIndex() {
  const session = await currentSession();
  if (!session) redirect("/login");
  const ws = await listUserWorkspaces(session.user.id);
  if (ws[0]) redirect(`/app/${ws[0].slug}`);
  if (session.user.platformRole === "SUPER_ADMIN") redirect("/admin");
  redirect("/app/new");
}
