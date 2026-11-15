"use client";
import { createContext, useContext, useEffect } from "react";
import { setWorkspaceHeader } from "@/lib/api";

export type WorkspaceInfo = { id: string; slug: string; name: string; type: string; status: string; emergencyPause: boolean; defaultLocale: string };
export type UserInfo = { id: string; name: string; email: string; platformRole: string; emailVerified: boolean };
type Ctx = { workspace: WorkspaceInfo; user: UserInfo; permissions: string[]; role: string | null; workspaces: { slug: string; name: string; role: { key: string } }[]; can: (p: string) => boolean };

const WorkspaceCtx = createContext<Ctx | null>(null);

export function WorkspaceProvider({ value, children }: { value: Omit<Ctx, "can">; children: React.ReactNode }) {
  // Set synchronously during render: child effects (data hooks) run before this provider's own effect.
  setWorkspaceHeader(value.workspace.slug);
  useEffect(() => {
    document.cookie = `pm_ws=${value.workspace.slug}; path=/; SameSite=Lax`;
  }, [value.workspace.slug]);
  const perms = new Set(value.permissions);
  return <WorkspaceCtx.Provider value={{ ...value, can: (p) => perms.has(p) }}>{children}</WorkspaceCtx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error("useWorkspace outside provider");
  return ctx;
}
