"use client";
import { useState } from "react";
import Link from "next/link";
import { Badge, LoadingBlock, PageHeader, Pagination, SearchInput, Select, Table, Td, Th } from "@/components/ui";
import { useApi, useDebounced } from "@/lib/hooks";
import { timeAgo } from "@/lib/utils";

type Row = { id: string; email: string; name: string; status: string; platformRole: string; emailVerifiedAt: string | null; lastLoginAt: string | null; createdAt: string; lockedUntil: string | null; memberships: { workspace: { id: string; name: string; slug: string }; role: { key: string; name: string }; status: string }[]; _count: { sessions: number } };

export default function UsersPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const list = useApi<{ rows: Row[]; total: number; pageSize: number }>(`/api/v1/platform/users?page=${page}${q ? `&search=${encodeURIComponent(q)}` : ""}${status ? `&status=${status}` : ""}${role ? `&platformRole=${role}` : ""}`);
  return (
    <div className="space-y-5">
      <PageHeader title="Users" description="All registered users across every workspace." />
      <div className="flex flex-wrap gap-2"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search email, name or organization…" className="w-full sm:w-80" /><Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36"><option value="">Any status</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></Select><Select value={role} onChange={(e) => setRole(e.target.value)} className="w-40"><option value="">Any platform role</option><option value="SUPER_ADMIN">Super Admin</option><option value="SUPPORT">Support</option><option value="NONE">None</option></Select></div>
      {list.loading && !list.data ? <LoadingBlock /> : (
        <>
          <Table>
            <thead><tr><Th>User</Th><Th>Workspaces</Th><Th>Platform role</Th><Th>Status</Th><Th>Sessions</Th><Th>Last login</Th></tr></thead>
            <tbody>{list.data?.rows.map((u) => <tr key={u.id} className="hover:bg-surface-2/60"><Td><Link href={`/admin/users/${u.id}`} className="font-medium text-text hover:text-primary">{u.name}</Link><div className="text-[12px] text-text-3">{u.email}{!u.emailVerifiedAt ? " · unverified" : ""}</div></Td><Td><div className="flex flex-wrap gap-1">{u.memberships.map((m) => <Badge key={m.workspace.id} tone="outline">{m.workspace.name} · {m.role.key}</Badge>)}</div></Td><Td>{u.platformRole !== "NONE" ? <Badge tone="warning">{u.platformRole.replace("_", " ").toLowerCase()}</Badge> : <span className="text-text-3">—</span>}</Td><Td><Badge tone={u.status === "ACTIVE" ? (u.lockedUntil && new Date(u.lockedUntil) > new Date() ? "warning" : "success") : "danger"}>{u.lockedUntil && new Date(u.lockedUntil) > new Date() ? "locked" : u.status.toLowerCase()}</Badge></Td><Td>{u._count.sessions}</Td><Td className="text-text-3">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : "never"}</Td></tr>)}</tbody>
          </Table>
          <Pagination page={page} pageSize={list.data?.pageSize ?? 25} total={list.data?.total ?? 0} onPage={setPage} />
        </>
      )}
    </div>
  );
}
