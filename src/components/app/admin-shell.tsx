"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Building2, Users, Shield, Package, CreditCard, Receipt, Mail, Cpu, Settings, Activity, ScrollText, LifeBuoy, Menu, X, LogOut, ArrowLeft } from "lucide-react";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { Avatar, Badge } from "@/components/ui";
import { api, setWorkspaceHeader } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Platform Overview", icon: LayoutDashboard },
  { href: "/admin/customers", label: "Customers & Organizations", icon: Building2 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/roles", label: "Roles & Permissions", icon: Shield },
  { href: "/admin/plans", label: "Subscription Plans", icon: Package },
  { href: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/admin/invoices", label: "Invoices & Payments", icon: Receipt },
  { href: "/admin/email", label: "Email Management", icon: Mail },
  { href: "/admin/ai", label: "AI Usage & Costs", icon: Cpu },
  { href: "/admin/settings", label: "Platform Settings", icon: Settings },
  { href: "/admin/health", label: "System Health", icon: Activity },
  { href: "/admin/audit", label: "Audit Logs", icon: ScrollText },
  { href: "/admin/support", label: "Support Access", icon: LifeBuoy },
];

export function AdminShell({ user, firstWorkspace, children }: { user: { id: string; name: string; email: string; platformRole: string }; firstWorkspace: string | null; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); setWorkspaceHeader(null); }, [pathname]);
  const sidebar = (
    <aside className="flex h-full w-[272px] flex-col border-r border-border bg-surface">
      <div className="flex h-16 items-center justify-between px-5"><Link href="/admin"><Logo /></Link><button className="rounded-xs p-1.5 text-text-3 hover:bg-surface-2 lg:hidden" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button></div>
      <div className="mx-3 rounded-sm bg-warning-soft px-3 py-2 text-[12px] font-medium text-warning">Super Admin Control Center</div>
      <nav className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-3 scrollbar-thin">
        {NAV.map((n) => {
          const active = n.href === "/admin" ? pathname === "/admin" : pathname.startsWith(n.href);
          return <Link key={n.href} href={n.href} className={cn("flex items-center gap-3 rounded-sm px-3 py-2 text-[13.5px] font-medium transition-colors", active ? "bg-primary-soft text-primary" : "text-text-2 hover:bg-surface-2 hover:text-text")}><n.icon className={cn("h-[18px] w-[18px]", active ? "text-primary" : "text-text-3")} />{n.label}</Link>;
        })}
        {firstWorkspace ? <Link href={`/app/${firstWorkspace}`} className="mt-3 flex items-center gap-3 rounded-sm border border-dashed border-border-strong px-3 py-2 text-[13.5px] font-medium text-text-2 hover:bg-surface-2"><ArrowLeft className="h-[18px] w-[18px]" /> Back to workspace</Link> : null}
      </nav>
      <div className="border-t border-border p-3"><div className="flex items-center gap-2.5 px-2 py-1.5"><Avatar name={user.name} size="sm" /><div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium text-text">{user.name}</div><div className="truncate text-[11px] text-text-3">{user.platformRole === "SUPER_ADMIN" ? "Super Admin" : "Support"}</div></div><button onClick={() => api.post("/api/v1/auth/logout").then(() => { router.push("/login"); router.refresh(); })} className="rounded-xs p-1.5 text-text-3 hover:text-danger"><LogOut className="h-4 w-4" /></button></div></div>
    </aside>
  );
  return (
    <div className="flex min-h-screen bg-bg">
      <div className="hidden lg:block lg:sticky lg:top-0 lg:h-screen">{sidebar}</div>
      {open ? <div className="fixed inset-0 z-50 lg:hidden"><div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} /><div className="absolute inset-y-0 left-0">{sidebar}</div></div> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-bg/85 px-4 backdrop-blur-md sm:px-6"><div className="flex items-center gap-2"><button className="rounded-xs p-2 text-text-2 hover:bg-surface-2 lg:hidden" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button><Badge tone="warning">Platform administration</Badge></div><ThemeToggle /></header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
