"use client";
import { Badge, Card, CardHeader, LoadingBlock, PageHeader, Table, Td, Th } from "@/components/ui";
import { useApi } from "@/lib/hooks";

type Data = { roles: { id: string; key: string; name: string; description: string; rank: number; isSystem: boolean; permissions: string[] }[]; catalogue: Record<string, { group: string; description: string }> };

export default function RolesPage() {
  // Reuse the first internal workspace's role listing isn't right for platform-level — show the system templates from the catalogue instead.
  const d = useApi<Data>("/api/v1/platform/roles");
  return (
    <div className="space-y-5">
      <PageHeader title="Roles & Permissions" description="System role templates provisioned into every workspace, and the full permission catalogue. Platform roles (Super Admin, Support) are assigned per user." />
      {!d.data ? <LoadingBlock /> : (
        <>
          <Card padded={false}><Table className="rounded-none border-0 shadow-none"><thead><tr><Th>Role</Th><Th>Rank</Th><Th>Permissions</Th></tr></thead><tbody>{d.data.roles.map((r) => <tr key={r.id}><Td><div className="font-medium">{r.name}</div><div className="text-[12px] text-text-3">{r.description}</div></Td><Td>{r.rank}</Td><Td><div className="flex flex-wrap gap-1">{r.permissions.map((p) => <Badge key={p} tone="outline" className="text-[10px]">{p}</Badge>)}</div></Td></tr>)}</tbody></Table></Card>
          <Card><CardHeader title="Permission catalogue" /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(d.data.catalogue).map(([k, v]) => <div key={k} className="rounded-sm border border-border p-3"><code className="text-[12px] text-primary">{k}</code><div className="text-[13px] text-text">{v.description}</div><div className="text-[11px] text-text-3">{v.group}</div></div>)}</div></Card>
        </>
      )}
    </div>
  );
}
