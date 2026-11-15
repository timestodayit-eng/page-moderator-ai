"use client";
import { useState } from "react";
import Link from "next/link";
import { Badge, Button, Dialog, Field, Input, LoadingBlock, PageHeader, Pagination, Select, Stat, Table, Td, Th, useToast } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/utils";

type Row = { id: string; number: string; status: string; totalCents: number; currency: string; dueAt: string; paidAt: string | null; createdAt: string; workspace: { id: string; name: string }; payments: { provider: string; reference: string | null; amountCents: number }[] };

export default function InvoicesPage() {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const list = useApi<{ rows: Row[]; total: number; pageSize: number; totals: Record<string, { count: number; cents: number }> }>(`/api/v1/platform/invoices?page=${page}${status ? `&status=${status}` : ""}`);
  const [pay, setPay] = useState<Row | null>(null);
  const [f, setF] = useState({ amount: "", reference: "", method: "bank" });
  const [busy, setBusy] = useState(false);
  const t = list.data?.totals ?? {};
  return (
    <div className="space-y-5">
      <PageHeader title="Invoices & Payments" description="Every invoice on the platform. Manual payments are recorded here after verification; online payments arrive through authenticated webhooks." />
      <div className="grid gap-4 sm:grid-cols-3"><Stat label="Open invoices" value={t.OPEN?.count ?? 0} sub={formatMoney(t.OPEN?.cents ?? 0)} tone="warning" /><Stat label="Paid" value={t.PAID?.count ?? 0} sub={formatMoney(t.PAID?.cents ?? 0)} tone="success" /><Stat label="Void / uncollectible" value={(t.VOID?.count ?? 0) + (t.UNCOLLECTIBLE?.count ?? 0)} /></div>
      <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40"><option value="">All</option><option value="OPEN">Open</option><option value="PAID">Paid</option><option value="VOID">Void</option></Select>
      {list.loading && !list.data ? <LoadingBlock /> : (
        <>
          <Table><thead><tr><Th>Invoice</Th><Th>Business</Th><Th>Amount</Th><Th>Due</Th><Th>Status</Th><Th>Payment</Th><Th></Th></tr></thead><tbody>{list.data?.rows.map((r) => <tr key={r.id}><Td className="font-medium">{r.number}</Td><Td><Link href={`/admin/customers/${r.workspace.id}`} className="text-primary">{r.workspace.name}</Link></Td><Td>{formatMoney(r.totalCents, r.currency)}</Td><Td className={r.status === "OPEN" && new Date(r.dueAt) < new Date() ? "text-danger" : "text-text-2"}>{formatDate(r.dueAt)}</Td><Td><Badge tone={r.status === "PAID" ? "success" : r.status === "OPEN" ? "warning" : "neutral"}>{r.status.toLowerCase()}</Badge></Td><Td className="text-[12px] text-text-2">{r.payments[0] ? `${r.payments[0].provider}${r.payments[0].reference ? ` · ${r.payments[0].reference}` : ""}` : "—"}</Td><Td>{r.status === "OPEN" ? <Button size="sm" variant="outline" onClick={() => { setF({ amount: String(r.totalCents / 100), reference: "", method: "bank" }); setPay(r); }}>Record payment</Button> : null}</Td></tr>)}</tbody></Table>
          <Pagination page={page} pageSize={list.data?.pageSize ?? 50} total={list.data?.total ?? 0} onPage={setPage} />
        </>
      )}
      <Dialog open={Boolean(pay)} onClose={() => setPay(null)} title={`Record payment — ${pay?.number}`} size="sm" footer={<><Button variant="outline" onClick={() => setPay(null)}>Cancel</Button><Button loading={busy} disabled={!f.reference} onClick={async () => { setBusy(true); try { await api.post(`/api/v1/invoices/${pay!.id}/manual-payment`, { amountCents: Math.round(Number(f.amount) * 100), currency: pay!.currency, reference: f.reference, method: f.method }); toast.success("Payment recorded"); setPay(null); list.refresh(); } catch (err) { toast.error("Failed", err instanceof ApiError ? err.message : undefined); } finally { setBusy(false); } }}>Record</Button></>}>
        <div className="space-y-3"><Field label="Amount"><Input type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field><Field label="Method"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="bank">Bank transfer</option><option value="bkash">bKash</option><option value="nagad">Nagad</option><option value="cash">Cash</option></Select></Field><Field label="Reference" required><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field></div>
      </Dialog>
    </div>
  );
}
