import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth/current";
import { listUserWorkspaces } from "@/server/platform/workspaces";
import { AdminShell } from "@/components/app/admin-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  if (!session) redirect("/login?next=/admin");
  if (session.user.platformRole !== "SUPER_ADMIN" && session.user.platformRole !== "SUPPORT") redirect("/app");
  const workspaces = await listUserWorkspaces(session.user.id);
  return <AdminShell user={{ id: session.user.id, name: session.user.name, email: session.user.email, platformRole: session.user.platformRole }} firstWorkspace={workspaces[0]?.slug ?? null}>{children}</AdminShell>;
}
