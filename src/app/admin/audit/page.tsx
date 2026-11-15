"use client";
import { useState } from "react";
import { Badge, Input, LoadingBlock, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";
import { useApi, useDebounced } from "@/lib/hooks";
import { formatDate } from "@/lib/utils";

type Row = { id: string; action: string; targetType: string | null; targetId: string | null; createdAt: string; ip: string | null; actorType: string; actor: { name: string; email: string } | null; workspace: { name: string; slug: string } | null; meta: Record<string, unknown> };

export default function AuditPage() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(action);
  const d = useApi<{ rows: Row[]; total: number; pageSize: number }>(`/api/v1/platform/audit-logs?page=${page}${q ? `&action=${encodeURIComponent(q)}` : ""}`);
  return (
    <div className="space-y-5">
      <PageHeader title="Audit Logs" description="Every privileged and security-relevant action across the platform." />
      <Input value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="Filter by action (e.g. platform., auth., page.)" className="w-80" />
      {d.loading && !d.data ? <LoadingBlock /> : <><Table><thead><tr><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Workspace</Th><Th>Target</Th><Th>IP</Th><Th>Details</Th></tr></thead><tbody>{d.data?.rows.map((r) => <tr key={r.id}><Td className="whitespace-nowrap text-text-2">{formatDate(r.createdAt, true)}</Td><Td>{r.actor ? <span>{r.actor.name}<span className="block text-[11px] text-text-3">{r.actor.email}</span></span> : <Badge tone="outline">{r.actorType.toLowerCase()}</Badge>}</Td><Td><code className="rounded bg-surface-2 px-1.5 py-0.5 text-[12px]">{r.action}</code></Td><Td className="text-text-2">{r.workspace?.name ?? "—"}</Td><Td className="text-text-2">{r.targetType ? `${r.targetType} …${r.targetId?.slice(-6)}` : "—"}</Td><Td className="text-[12px] text-text-3">{r.ip ?? "—"}</Td><Td className="max-w-sm truncate text-[12px] text-text-3" title={JSON.stringify(r.meta, null, 1)}>{JSON.stringify(r.meta).slice(0, 100)}</Td></tr>)}</tbody></Table><Pagination page={page} pageSize={d.data?.pageSize ?? 50} total={d.data?.total ?? 0} onPage={setPage} /></>}
    </div>
  );
}
