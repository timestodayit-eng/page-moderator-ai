"use client";
import { useState } from "react";
import Link from "next/link";
import { Badge, LoadingBlock, PageHeader, Pagination, Select, Table, Td, Th } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { formatDate } from "@/lib/utils";

type Row = { id: string; name: string; slug: string; type: string; status: string; billingExempt: boolean; plan: { key: string; name: string } | null; subscriptionStatus: string | null; periodEnd: string | null; owner: { email: string } | null };
const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "primary"> = { ACTIVE: "success", TRIALING: "primary", GRACE: "warning", PAST_DUE: "warning", EXPIRED: "danger", CANCELED: "danger", SUSPENDED: "danger", EXEMPT: "neutral" };

export default function SubscriptionsPage() {
  const [plan, setPlan] = useState("");
  const [page, setPage] = useState(1);
  const list = useApi<{ rows: Row[]; total: number; pageSize: number }>(`/api/v1/platform/workspaces?page=${page}${plan ? `&plan=${plan}` : ""}`);
  const plans = useApi<{ plans: { key: string; name: string }[] }>("/api/v1/platform/plans");
  const rows = list.data?.rows ?? [];
  return (
    <div className="space-y-5">
      <PageHeader title="Subscriptions" description="Status, renewals and service entitlements per business. Open a customer to assign plans, extend trials or override limits." />
      <Select value={plan} onChange={(e) => { setPlan(e.target.value); setPage(1); }} className="w-48"><option value="">All plans</option>{plans.data?.plans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select>
      {list.loading && !list.data ? <LoadingBlock /> : (
        <>
          <Table><thead><tr><Th>Business</Th><Th>Plan</Th><Th>Subscription</Th><Th>Renews / ends</Th><Th>Billing</Th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><Td><Link href={`/admin/customers/${r.id}`} className="font-medium text-text hover:text-primary">{r.name}</Link><div className="text-[12px] text-text-3">{r.owner?.email}</div></Td><Td>{r.plan?.name ?? "—"}</Td><Td>{r.subscriptionStatus ? <Badge tone={TONE[r.subscriptionStatus]}>{r.subscriptionStatus.toLowerCase().replace("_", " ")}</Badge> : "—"}</Td><Td className={r.periodEnd && new Date(r.periodEnd) < new Date() ? "text-danger" : "text-text-2"}>{formatDate(r.periodEnd)}</Td><Td>{r.billingExempt ? <Badge tone="primary">exempt</Badge> : <Badge tone="outline">billed</Badge>}</Td></tr>)}</tbody></Table>
          <Pagination page={page} pageSize={list.data?.pageSize ?? 25} total={list.data?.total ?? 0} onPage={setPage} />
        </>
      )}
    </div>
  );
}
