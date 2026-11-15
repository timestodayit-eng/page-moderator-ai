"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Globe as Facebook, ShieldCheck, Bot, GraduationCap, MessageSquare, KanbanSquare, Users, BarChart3, CreditCard, UserCog, Settings, Menu, X, Bell, ChevronsUpDown, LogOut, ShieldAlert, Gauge, Inbox } from "lucide-react";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { useWorkspace } from "./workspace-context";
import { Avatar, Badge } from "@/components/ui";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";

const NAV = [
  { href: "", label: "Overview", icon: LayoutDashboard, perm: "dashboard.view" },
  { href: "/pages", label: "Facebook Pages", icon: Facebook, perm: "dashboard.view" },
  { href: "/moderation", label: "AI Moderation", icon: ShieldCheck, perm: "comments.read" },
  { href: "/agents", label: "AI Agent Studio", icon: Bot, perm: "dashboard.view" },
  { href: "/training", label: "AI Training Center", icon: GraduationCap, perm: "dashboard.view" },
  { href: "/inbox", label: "Messenger Inbox", icon: MessageSquare, perm: "inbox.manage" },
  { href: "/crm", label: "CRM & Leads", icon: KanbanSquare, perm: "crm.access" },
  { href: "/customers", label: "Customers", icon: Users, perm: "crm.access" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, perm: "analytics.view" },
  { href: "/usage", label: "Usage", icon: Gauge, perm: "billing.view" },
  { href: "/billing", label: "Subscription & Billing", icon: CreditCard, perm: "billing.view" },
  { href: "/team", label: "Team Management", icon: UserCog, perm: "team.manage" },
  { href: "/settings", label: "Settings", icon: Settings, perm: "dashboard.view" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { workspace, user, workspaces, can } = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<{ notifications: { id: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }[]; unread: number } | null>(null);
  const base = `/app/${workspace.slug}`;
  useEffect(() => setOpen(false), [pathname]);
  const loadNotifs = () => api.get<typeof notifs>("/api/v1/notifications").then(setNotifs).catch(() => {});
  useEffect(() => {
    void loadNotifs();
    const t = setInterval(loadNotifs, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.slug]);

  async function logout() {
    await api.post("/api/v1/auth/logout");
    router.push("/login");
    router.refresh();
  }

  const sidebar = (
    <aside className="flex h-full w-[264px] flex-col border-r border-border bg-surface">
      <div className="flex h-16 items-center justify-between px-5">
        <Link href={base}><Logo /></Link>
        <button className="rounded-xs p-1.5 text-text-3 hover:bg-surface-2 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-4 w-4" /></button>
      </div>
      <div className="px-3">
        <button onClick={() => setSwitcher((s) => !s)} className="flex w-full items-center gap-2.5 rounded-sm border border-border px-3 py-2 text-left transition-colors hover:bg-surface-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-primary-soft text-[12px] font-semibold text-primary">{workspace.name.slice(0, 2).toUpperCase()}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-text">{workspace.name}</span>
            <span className="block text-[11px] text-text-3">{workspace.type === "INTERNAL" ? "Internal business" : "Workspace"}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 text-text-3" />
        </button>
        {switcher ? (
          <div className="mt-1 rounded-sm border border-border bg-surface p-1 shadow-card animate-fade-up">
            {workspaces.map((w) => (
              <Link key={w.slug} href={`/app/${w.slug}`} onClick={() => setSwitcher(false)} className={cn("flex items-center justify-between rounded-xs px-2.5 py-2 text-[13px] hover:bg-surface-2", w.slug === workspace.slug ? "font-semibold text-text" : "text-text-2")}>
                <span className="truncate">{w.name}</span>
                <span className="text-[11px] text-text-3">{w.role.key}</span>
              </Link>
            ))}
            <Link href="/app/new" className="mt-1 block rounded-xs border-t border-border px-2.5 py-2 text-[13px] text-primary hover:bg-surface-2">+ New workspace</Link>
          </div>
        ) : null}
      </div>
      <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-3 scrollbar-thin">
        {NAV.filter((n) => can(n.perm)).map((n) => {
          const href = base + n.href;
          const active = n.href === "" ? pathname === base : pathname.startsWith(href);
          return (
            <Link key={n.href} href={href} className={cn("flex items-center gap-3 rounded-sm px-3 py-2 text-[13.5px] font-medium transition-colors", active ? "bg-primary-soft text-primary" : "text-text-2 hover:bg-surface-2 hover:text-text")}>
              <n.icon className={cn("h-[18px] w-[18px]", active ? "text-primary" : "text-text-3")} />
              {n.label}
            </Link>
          );
        })}
        {user.platformRole === "SUPER_ADMIN" || user.platformRole === "SUPPORT" ? (
          <Link href="/admin" className="mt-3 flex items-center gap-3 rounded-sm border border-dashed border-border-strong px-3 py-2 text-[13.5px] font-medium text-text-2 hover:bg-surface-2 hover:text-text">
            <ShieldAlert className="h-[18px] w-[18px] text-warning" /> Platform Administration
          </Link>
        ) : null}
      </nav>
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-sm px-2 py-1.5">
          <Avatar name={user.name} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-text">{user.name}</div>
            <div className="truncate text-[11px] text-text-3">{user.email}</div>
          </div>
          <button onClick={logout} className="rounded-xs p-1.5 text-text-3 hover:bg-surface-2 hover:text-danger" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-bg">
      <div className="hidden lg:block lg:sticky lg:top-0 lg:h-screen">{sidebar}</div>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 animate-fade-up">{sidebar}</div>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-2">
            <button className="rounded-xs p-2 text-text-2 hover:bg-surface-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
            {workspace.emergencyPause ? <Badge tone="danger">Emergency pause ON — automation stopped</Badge> : workspace.status !== "ACTIVE" ? <Badge tone="warning">Workspace {workspace.status.toLowerCase()}</Badge> : null}
            {!user.emailVerified ? <Badge tone="warning">Email not verified</Badge> : null}
          </div>
          <div className="flex items-center gap-1">
            <div className="relative">
              <button onClick={() => { setNotifOpen((o) => !o); if (!notifOpen && notifs?.unread) api.post("/api/v1/notifications", { all: true }).then(loadNotifs); }} className="relative flex h-9 w-9 items-center justify-center rounded-xs text-text-2 hover:bg-surface-2 hover:text-text" aria-label="Notifications">
                <Bell className="h-[18px] w-[18px]" />
                {notifs?.unread ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger ring-2 ring-bg" /> : null}
              </button>
              {notifOpen ? (
                <div className="absolute right-0 mt-2 w-[340px] rounded-card border border-border bg-surface p-2 shadow-pop animate-fade-up">
                  <div className="px-2 py-1.5 text-[12px] font-semibold uppercase tracking-wider text-text-3">Notifications</div>
                  <div className="max-h-[360px] overflow-y-auto scrollbar-thin">
                    {notifs?.notifications.length ? notifs.notifications.map((n) => (
                      <Link key={n.id} href={n.link ?? "#"} onClick={() => setNotifOpen(false)} className={cn("block rounded-xs px-2.5 py-2 hover:bg-surface-2", !n.readAt && "bg-primary-soft/40")}>
                        <div className="text-[13px] font-medium text-text">{n.title}</div>
                        {n.body ? <div className="line-clamp-2 text-[12px] text-text-2">{n.body}</div> : null}
                        <div className="mt-0.5 text-[11px] text-text-3">{timeAgo(n.createdAt)}</div>
                      </Link>
                    )) : <div className="flex items-center gap-2 px-2.5 py-6 text-[13px] text-text-3"><Inbox className="h-4 w-4" /> You're all caught up.</div>}
                  </div>
                </div>
              ) : null}
            </div>
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
