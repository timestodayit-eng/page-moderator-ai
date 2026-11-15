"use client";
import { use, useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Field, KeyValue, LoadingBlock, PageHeader, Select, Table, Td, Th, useToast } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/utils";

type Detail = { user: { id: string; email: string; name: string; status: string; platformRole: string; locale: string; emailVerifiedAt: string | null; lastLoginAt: string | null; createdAt: string; mfaEnabled: boolean; failedLoginCount: number; lockedUntil: string | null; passwordChangedAt: string | null; memberships: { id: string; status: string; workspace: { id: string; name: string; slug: string; status: string }; role: { id: string; key: string; name: string } }[]; sessions: { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string }[] }; activity: { id: string; action: string; createdAt: string; workspaceId: string | null }[]; security: { id: string; action: string; createdAt: string; ip: string | null; meta: Record<string, unknown> }[] };

export default function UserDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const d = useApi<Detail>(`/api/v1/platform/users/${id}`);
  const workspaces = useApi<{ rows: { id: string; name: string }[] }>("/api/v1/platform/workspaces?pageSize=100");
  const [assign, setAssign] = useState(false);
  const [wsId, setWsId] = useState("");
  const [roleKey, setRoleKey] = useState("viewer");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      d.refresh();
    } catch (err) {
      toast.error("Failed", err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };
  if (!d.data) return d.error ? <Alert tone="danger">{d.error}</Alert> : <LoadingBlock rows={6} />;
  const u = d.data.user;
  return (
    <div className="space-y-6">
      <PageHeader crumbs={["Users"]} title={u.name} description={u.email} actions={<>
        {u.status === "ACTIVE" ? <Button variant="danger" loading={busy} onClick={() => confirm("Suspend this user? All sessions will be revoked.") && run(() => api.patch(`/api/v1/platform/users/${id}`, { status: "SUSPENDED" }), "User suspended")}>Suspend</Button> : <Button loading={busy} onClick={() => run(() => api.patch(`/api/v1/platform/users/${id}`, { status: "ACTIVE" }), "User restored")}>Restore</Button>}
        <Button variant="outline" loading={busy} onClick={() => run(() => api.delete(`/api/v1/platform/users/${id}/sessions`), "Sessions revoked")}>Revoke sessions</Button>
        <Button variant="outline" loading={busy} onClick={() => run(() => api.post(`/api/v1/platform/users/${id}/password-reset`), "Reset email sent")}>Send password reset</Button>
      </>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card><CardHeader title="Account" /><KeyValue items={[{ k: "Status", v: <Badge tone={u.status === "ACTIVE" ? "success" : "danger"}>{u.status.toLowerCase()}</Badge> }, { k: "Email verified", v: u.emailVerifiedAt ? formatDate(u.emailVerifiedAt) : "no" }, { k: "Platform role", v: <Select value={u.platformRole} onChange={(e) => run(() => api.patch(`/api/v1/platform/users/${id}`, { platformRole: e.target.value }), "Platform role updated")} className="h-8 w-36 text-[13px]"><option value="NONE">None</option><option value="SUPPORT">Support</option><option value="SUPER_ADMIN">Super Admin</option></Select> }, { k: "MFA", v: u.mfaEnabled ? "enabled" : "off" }, { k: "Failed logins", v: `${u.failedLoginCount}${u.lockedUntil && new Date(u.lockedUntil) > new Date() ? ` (locked until ${formatDate(u.lockedUntil, true)})` : ""}` }, { k: "Password changed", v: formatDate(u.passwordChangedAt) }, { k: "Last login", v: u.lastLoginAt ? timeAgo(u.lastLoginAt) : "never" }, { k: "Created", v: formatDate(u.createdAt) }]} /></Card>
        <Card className="lg:col-span-2"><CardHeader title="Workspaces" action={<Button size="sm" variant="outline" onClick={() => setAssign(true)}>Assign to workspace</Button>} /><Table className="shadow-none"><thead><tr><Th>Workspace</Th><Th>Role</Th><Th>Status</Th><Th></Th></tr></thead><tbody>{u.memberships.map((m) => <tr key={m.id}><Td><a href={`/admin/customers/${m.workspace.id}`} className="text-primary">{m.workspace.name}</a></Td><Td>{m.role.name}</Td><Td><Badge tone={m.status === "ACTIVE" ? "success" : "danger"}>{m.status.toLowerCase()}</Badge></Td><Td><Button size="sm" variant="ghost" className="text-danger" onClick={() => confirm("Remove membership?") && run(() => api.post(`/api/v1/platform/users/${id}/membership`, { workspaceId: m.workspace.id, roleKey: null }), "Membership removed")}>Remove</Button></Td></tr>)}{!u.memberships.length ? <tr><Td colSpan={4} className="text-center text-text-3">No memberships</Td></tr> : null}</tbody></Table></Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardHeader title="Active sessions" /><ul className="divide-y divide-border text-sm">{u.sessions.map((s) => <li key={s.id} className="py-2"><div className="truncate text-text">{s.userAgent ?? "Unknown"}</div><div className="text-[12px] text-text-3">{s.ip ?? "—"} · {formatDate(s.createdAt, true)} · active {timeAgo(s.lastSeenAt)}</div></li>)}{!u.sessions.length ? <li className="py-2 text-text-3">No active sessions</li> : null}</ul></Card>
        <Card><CardHeader title="Security events" /><ul className="divide-y divide-border text-[13px]">{d.data.security.map((e) => <li key={e.id} className="flex justify-between py-2"><span><code className="text-[12px]">{e.action}</code><span className="ml-2 text-text-3">{e.ip ?? ""}</span></span><span className="text-text-3">{timeAgo(e.createdAt)}</span></li>)}{!d.data.security.length ? <li className="py-2 text-text-3">None</li> : null}</ul></Card>
      </div>
      <Card><CardHeader title="Recent activity" /><ul className="divide-y divide-border text-[13px]">{d.data.activity.map((a) => <li key={a.id} className="flex justify-between py-2"><code className="text-[12px]">{a.action}</code><span className="text-text-3">{timeAgo(a.createdAt)}</span></li>)}</ul></Card>
      <Dialog open={assign} onClose={() => setAssign(false)} title="Assign to workspace" size="sm" footer={<><Button variant="outline" onClick={() => setAssign(false)}>Cancel</Button><Button loading={busy} disabled={!wsId} onClick={async () => { await run(() => api.post(`/api/v1/platform/users/${id}/membership`, { workspaceId: wsId, roleKey }), "Membership saved"); setAssign(false); }}>Assign</Button></>}>
        <div className="space-y-3"><Field label="Workspace"><Select value={wsId} onChange={(e) => setWsId(e.target.value)}><option value="">Select…</option>{workspaces.data?.rows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field><Field label="Role"><Select value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>{["owner", "admin", "manager", "moderator", "support", "crm", "viewer"].map((r) => <option key={r} value={r}>{r}</option>)}</Select></Field></div>
      </Dialog>
    </div>
  );
}
