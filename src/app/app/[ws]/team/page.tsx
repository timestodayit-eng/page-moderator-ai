"use client";
import { useState } from "react";
import { UserPlus, Shield, Trash2, Plus } from "lucide-react";
import { Avatar, Badge, Button, Card, CardHeader, Checkbox, Dialog, Field, Input, LoadingBlock, PageHeader, Select, Table, Tabs, Td, Th, useToast } from "@/components/ui";
import { useWorkspace } from "@/components/app/workspace-context";
import { useApi } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/utils";

type Members = { members: { id: string; status: string; createdAt: string; user: { id: string; email: string; name: string; status: string; lastLoginAt: string | null; emailVerifiedAt: string | null }; role: { id: string; key: string; name: string; rank: number } }[]; invitations: { id: string; email: string; expiresAt: string; role: { name: string }; invitedBy: { name: string } }[] };
type Roles = { roles: { id: string; key: string; name: string; description: string; rank: number; isSystem: boolean; members: number; permissions: string[] }[]; catalogue: Record<string, { group: string; description: string }> };

export default function TeamPage() {
  const { user } = useWorkspace();
  const toast = useToast();
  const [tab, setTab] = useState<"members" | "roles">("members");
  const members = useApi<Members>("/api/v1/team/members");
  const roles = useApi<Roles>("/api/v1/team/roles");
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [editingRole, setEditingRole] = useState<Roles["roles"][number] | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const refresh = () => { members.refresh(); roles.refresh(); };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
      refresh();
    } catch (err) {
      toast.error("Action failed", err instanceof ApiError ? err.message : undefined);
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Team Management" description="Invite employees, assign roles and control exactly what each role can do." actions={<Button onClick={() => { setInviting(true); setRoleId(roles.data?.roles.find((r) => r.key === "moderator")?.id ?? ""); }}><UserPlus className="h-4 w-4" /> Invite member</Button>} />
      <Tabs value={tab} onChange={setTab} items={[{ value: "members", label: "Members", count: members.data?.members.length }, { value: "roles", label: "Roles & permissions", count: roles.data?.roles.length }]} />
      {tab === "members" ? (
        <div className="space-y-5">
          {members.loading ? <LoadingBlock /> : (
            <Table>
              <thead><tr><Th>Member</Th><Th>Role</Th><Th>Status</Th><Th>Last sign-in</Th><Th>Joined</Th><Th></Th></tr></thead>
              <tbody>{members.data?.members.map((m) => (
                <tr key={m.id}>
                  <Td><div className="flex items-center gap-3"><Avatar name={m.user.name} size="sm" /><div><div className="font-medium">{m.user.name}{m.user.id === user.id ? <span className="ml-1 text-[11px] text-text-3">(you)</span> : null}</div><div className="text-[12px] text-text-3">{m.user.email}{!m.user.emailVerifiedAt ? " · unverified" : ""}</div></div></div></Td>
                  <Td>{m.user.id === user.id || m.role.key === "owner" ? <Badge tone={m.role.key === "owner" ? "primary" : "neutral"}>{m.role.name}</Badge> : <Select value={m.role.id} onChange={(e) => run(() => api.patch("/api/v1/team/members", { membershipId: m.id, roleId: e.target.value }), "Role updated")} className="h-8 w-44 text-[13px]">{roles.data?.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Td>
                  <Td><Badge tone={m.status === "ACTIVE" && m.user.status === "ACTIVE" ? "success" : "danger"}>{m.user.status !== "ACTIVE" ? "account suspended" : m.status.toLowerCase()}</Badge></Td>
                  <Td className="text-text-2">{m.user.lastLoginAt ? timeAgo(m.user.lastLoginAt) : "never"}</Td>
                  <Td className="text-text-2">{formatDate(m.createdAt)}</Td>
                  <Td>{m.user.id !== user.id && m.role.key !== "owner" ? <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => run(() => api.patch("/api/v1/team/members", { membershipId: m.id, status: m.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }), m.status === "ACTIVE" ? "Member suspended" : "Member restored")}>{m.status === "ACTIVE" ? "Suspend" : "Restore"}</Button><Button size="sm" variant="ghost" className="text-danger" onClick={() => confirm(`Remove ${m.user.name} from the workspace?`) && run(() => api.delete("/api/v1/team/members", { membershipId: m.id }), "Member removed")}><Trash2 className="h-4 w-4" /></Button></div> : null}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
          {members.data?.invitations.length ? (
            <Card><CardHeader title="Pending invitations" /><ul className="divide-y divide-border text-sm">{members.data.invitations.map((i) => <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5"><span><span className="font-medium text-text">{i.email}</span> <span className="text-text-2">as {i.role.name} · invited by {i.invitedBy.name} · expires {formatDate(i.expiresAt)}</span></span><Button size="sm" variant="ghost" onClick={() => run(() => api.delete("/api/v1/team/invitations", { invitationId: i.id }), "Invitation revoked")}>Revoke</Button></li>)}</ul></Card>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end"><Button variant="outline" onClick={() => setEditingRole("new")}><Plus className="h-4 w-4" /> Custom role</Button></div>
          {roles.loading ? <LoadingBlock /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{roles.data?.roles.map((r) => (
            <Card key={r.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-2"><div><div className="flex items-center gap-2 text-[15px] font-semibold text-text"><Shield className="h-4 w-4 text-primary" />{r.name}</div><div className="mt-0.5 text-[12px] text-text-2">{r.description}</div></div><Badge tone={r.isSystem ? "neutral" : "primary"}>{r.isSystem ? "system" : "custom"}</Badge></div>
              <div className="mt-3 flex flex-wrap gap-1">{r.permissions.slice(0, 8).map((p) => <Badge key={p} tone="outline" className="text-[10px]">{p}</Badge>)}{r.permissions.length > 8 ? <Badge tone="outline" className="text-[10px]">+{r.permissions.length - 8}</Badge> : null}</div>
              <div className="mt-auto flex items-center justify-between pt-4 text-[12px] text-text-3"><span>{r.members} member{r.members === 1 ? "" : "s"} · rank {r.rank}</span>{r.key !== "owner" ? <Button size="sm" variant="ghost" onClick={() => setEditingRole(r)}>Edit permissions</Button> : null}</div>
            </Card>
          ))}</div>}
        </div>
      )}
      <Dialog open={inviting} onClose={() => setInviting(false)} title="Invite a team member" description="They will receive an email with a 7-day link. Existing accounts must sign in to accept." size="sm" footer={<><Button variant="outline" onClick={() => setInviting(false)}>Cancel</Button><Button loading={saving} disabled={!email || !roleId} onClick={async () => { setSaving(true); await run(() => api.post("/api/v1/team/members", { email, roleId }), "Invitation sent"); setSaving(false); setInviting(false); setEmail(""); }}>Send invitation</Button></>}>
        <div className="space-y-4"><Field label="Email" required><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field><Field label="Role" required><Select value={roleId} onChange={(e) => setRoleId(e.target.value)}><option value="">Select…</option>{roles.data?.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field></div>
      </Dialog>
      {editingRole ? <RoleDialog role={editingRole === "new" ? null : editingRole} catalogue={roles.data?.catalogue ?? {}} onClose={() => setEditingRole(null)} onSaved={() => { setEditingRole(null); refresh(); }} /> : null}
    </div>
  );
}

function RoleDialog({ role, catalogue, onClose, onSaved }: { role: Roles["roles"][number] | null; catalogue: Roles["catalogue"]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? ["dashboard.view"]);
  const [saving, setSaving] = useState(false);
  const groups = Object.entries(catalogue).reduce<Record<string, [string, { description: string }][]>>((acc, [k, v]) => { (acc[v.group] ??= []).push([k, v]); return acc; }, {});
  async function save() {
    setSaving(true);
    try {
      if (role) await api.patch("/api/v1/team/roles", { roleId: role.id, name, description, permissions: perms });
      else await api.post("/api/v1/team/roles", { name, description, permissions: perms });
      toast.success(role ? "Role updated" : "Role created");
      onSaved();
    } catch (err) {
      toast.error("Could not save role", err instanceof ApiError ? err.message : undefined);
      setSaving(false);
    }
  }
  async function remove() {
    if (!role || !confirm("Delete this role?")) return;
    try {
      await api.delete("/api/v1/team/roles", { roleId: role.id });
      onSaved();
    } catch (err) {
      toast.error("Could not delete", err instanceof ApiError ? err.message : undefined);
    }
  }
  return (
    <Dialog open onClose={onClose} title={role ? `Edit ${role.name}` : "New custom role"} description="You can only grant permissions you hold yourself. Changes are logged." size="lg" footer={<>{role && !role.isSystem ? <Button variant="ghost" className="mr-auto text-danger" onClick={remove}>Delete role</Button> : null}<Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={saving} disabled={!name} onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field></div>
        <div className="grid gap-4 sm:grid-cols-2">{Object.entries(groups).map(([g, items]) => <div key={g} className="rounded-sm border border-border p-3"><div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-text-3">{g}</div><div className="space-y-1.5">{items.map(([k, v]) => <Checkbox key={k} checked={perms.includes(k)} onChange={(c) => setPerms((p) => (c ? [...p, k] : p.filter((x) => x !== k)))} label={<span><span className="text-text">{v.description}</span> <span className="text-[11px] text-text-3">{k}</span></span>} />)}</div></div>)}</div>
      </div>
    </Dialog>
  );
}
