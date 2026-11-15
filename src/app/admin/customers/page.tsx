"use client";
import { useState } from "react";
import Link from "next/link";
import { Plus, Building2 } from "lucide-react";
import { Badge, Button, Dialog, EmptyState, Field, Input, LoadingBlock, PageHeader, Pagination, SearchInput, Select, Table, Td, Th, useToast } from "@/components/ui";
import { useApi, useDebounced } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/utils";

type Row = { id: string; slug: string; name: string; type: string; status: string; billingExempt: boolean; createdAt: string; plan: { key: string; name: string } | null; subscriptionStatus: string | null; periodEnd: string | null; members: number; pages: number; owner: { email: string; name: string } | null };
const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "primary"> = { ACTIVE: "success", PENDING: "warning", SUSPENDED: "danger", CLOSED: "neutral", TRIALING: "primary", GRACE: "warning", PAST_DUE: "warning", EXPIRED: "danger", CANCELED: "danger", EXEMPT: "neutral" };

export default function CustomersPage() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search);
  const list = useApi<{ rows: Row[]; total: number; pageSize: number }>(`/api/v1/platform/workspaces?page=${page}${q ? `&search=${encodeURIComponent(q)}` : ""}${status ? `&status=${status}` : ""}${type ? `&type=${type}` : ""}`);
  const [f, setF] = useState({ name: "", ownerEmail: "", ownerName: "", type: "CUSTOMER", planKey: "starter" });
  const [saving, setSaving] = useState(false);
  async function create() {
    setSaving(true);
    try {
      await api.post("/api/v1/platform/workspaces", { ...f, billingExempt: f.type === "INTERNAL" });
      toast.success("Business account created", "The owner received a setup email.");
      setCreating(false);
      list.refresh();
    } catch (err) {
      toast.error("Could not create", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-5">
      <PageHeader title="Customers & Organizations" description="Every workspace on the platform — internal businesses and external subscribers." actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Create business account</Button>} />
      <div className="flex flex-wrap gap-2"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name, slug or owner email…" className="w-full sm:w-80" /><Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40"><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="PENDING">Pending approval</option><option value="SUSPENDED">Suspended</option><option value="CLOSED">Closed</option></Select><Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="w-40"><option value="">All types</option><option value="INTERNAL">Internal</option><option value="CUSTOMER">Customer</option></Select></div>
      {list.loading && !list.data ? <LoadingBlock /> : !list.data?.rows.length ? <EmptyState icon={<Building2 className="h-6 w-6" />} title="No workspaces" /> : (
        <>
          <Table>
            <thead><tr><Th>Business</Th><Th>Owner</Th><Th>Type</Th><Th>Status</Th><Th>Plan</Th><Th>Pages</Th><Th>Members</Th><Th>Created</Th></tr></thead>
            <tbody>{list.data.rows.map((r) => <tr key={r.id} className="hover:bg-surface-2/60"><Td><Link href={`/admin/customers/${r.id}`} className="font-medium text-text hover:text-primary">{r.name}</Link><div className="text-[12px] text-text-3">{r.slug}</div></Td><Td>{r.owner ? <span>{r.owner.name}<span className="block text-[12px] text-text-3">{r.owner.email}</span></span> : "—"}</Td><Td><Badge tone={r.type === "INTERNAL" ? "primary" : "neutral"}>{r.type.toLowerCase()}</Badge></Td><Td><Badge tone={TONE[r.status]}>{r.status.toLowerCase()}</Badge></Td><Td>{r.plan ? <span>{r.plan.name}<span className="block text-[12px] text-text-3">{r.billingExempt ? "exempt" : `${r.subscriptionStatus?.toLowerCase()} · until ${formatDate(r.periodEnd)}`}</span></span> : "—"}</Td><Td>{r.pages}</Td><Td>{r.members}</Td><Td className="text-text-3">{timeAgo(r.createdAt)}</Td></tr>)}</tbody>
          </Table>
          <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </>
      )}
      <Dialog open={creating} onClose={() => setCreating(false)} title="Create business account" description="The owner gets an email to set their password. Internal businesses are billing-exempt but still metered." size="md" footer={<><Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button><Button onClick={create} loading={saving} disabled={!f.name || !f.ownerEmail || !f.ownerName}>Create</Button></>}>
        <div className="space-y-4"><Field label="Business name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Owner name" required><Input value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} /></Field><Field label="Owner email" required><Input type="email" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} /></Field><Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, planKey: e.target.value === "INTERNAL" ? "enterprise" : "starter" })}><option value="CUSTOMER">Customer (subscription)</option><option value="INTERNAL">Internal business (exempt)</option></Select></Field><Field label="Plan"><Select value={f.planKey} onChange={(e) => setF({ ...f, planKey: e.target.value })}><option value="starter">Starter</option><option value="growth">Growth</option><option value="business">Business</option><option value="enterprise">Enterprise</option></Select></Field></div></div>
      </Dialog>
    </div>
  );
}
