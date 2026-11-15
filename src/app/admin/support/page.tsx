"use client";
import { Alert, Badge, Button, LoadingBlock, PageHeader, Table, Td, Th, useToast } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { api } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/utils";

type Grant = { id: string; reason: string; scope: string; status: string; expiresAt: string | null; createdAt: string; requestedById: string; workspace: { name: string; slug: string } };

export default function SupportPage() {
  const toast = useToast();
  const d = useApi<{ grants: Grant[] }>("/api/v1/platform/support-access");
  return (
    <div className="space-y-5">
      <PageHeader title="Support Access" description="Audited, time-boxed access to customers' private Messenger conversations. Request from a customer's page; the workspace owner approves." />
      <Alert tone="info">Super Admin oversight covers dashboards, comments, analytics, billing and audit logs without approval. Private messages always require an approved grant, and every grant and access is logged.</Alert>
      {!d.data ? <LoadingBlock /> : <Table><thead><tr><Th>Workspace</Th><Th>Reason</Th><Th>Scope</Th><Th>Status</Th><Th>Expires</Th><Th>Requested</Th><Th></Th></tr></thead><tbody>{d.data.grants.map((g) => <tr key={g.id}><Td className="font-medium">{g.workspace.name}</Td><Td className="max-w-sm text-text-2">{g.reason}</Td><Td><code className="text-[12px]">{g.scope}</code></Td><Td><Badge tone={g.status === "APPROVED" ? "success" : g.status === "REQUESTED" ? "warning" : "neutral"}>{g.status.toLowerCase()}</Badge></Td><Td className="text-text-2">{formatDate(g.expiresAt, true)}</Td><Td className="text-text-3">{timeAgo(g.createdAt)}</Td><Td>{g.status === "APPROVED" || g.status === "REQUESTED" ? <Button size="sm" variant="ghost" className="text-danger" onClick={() => api.delete("/api/v1/platform/support-access", { grantId: g.id }).then(() => { toast.success("Revoked"); d.refresh(); })}>Revoke</Button> : null}</Td></tr>)}{!d.data.grants.length ? <tr><Td colSpan={7} className="py-8 text-center text-text-3">No access requests</Td></tr> : null}</tbody></Table>}
    </div>
  );
}
