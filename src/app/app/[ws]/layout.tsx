import { notFound, redirect } from "next/navigation";
import { currentSession, workspaceContextFor } from "@/server/auth/current";
import { listUserWorkspaces } from "@/server/platform/workspaces";
import { WorkspaceProvider } from "@/components/app/workspace-context";
import { AppShell } from "@/components/app/shell";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const session = await currentSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/app/${ws}`)}`);
  const ctx = await workspaceContextFor(ws);
  if (!ctx) notFound();
  const workspaces = await listUserWorkspaces(session.user.id);
  const w = ctx.workspace;
  return (
    <WorkspaceProvider
      value={{
        workspace: { id: w.id, slug: w.slug, name: w.name, type: w.type, status: w.status, emergencyPause: w.emergencyPause, defaultLocale: w.defaultLocale },
        user: { id: session.user.id, name: session.user.name, email: session.user.email, platformRole: session.user.platformRole, emailVerified: Boolean(session.user.emailVerifiedAt) },
        permissions: [...ctx.permissions],
        role: ctx.membership?.role.key ?? null,
        workspaces: workspaces.map((x) => ({ slug: x.slug, name: x.name, role: { key: x.role.key } })),
      }}
    >
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
