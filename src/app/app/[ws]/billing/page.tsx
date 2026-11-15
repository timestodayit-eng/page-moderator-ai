"use client";
import { Suspense } from "react";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CreditCard, Check } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Dialog, KeyValue, LoadingBlock, PageHeader, Table, Td, Th, useToast } from "@/components/ui";
import { useWorkspace } from "@/components/app/workspace-context";
import { useApi } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/utils";

type Sub = { subscription: { status: string; interval: string; currentPeriodStart: string; currentPeriodEnd: string; trialEndsAt: string | null; graceEndsAt: string | null; cancelAtPeriodEnd: boolean; discountPercent: number; plan: { key: string; name: string; priceMonthlyCents: number; priceYearlyCents: number; currency: string } } | null; limits: Record<string, number>; counts: { pages: number; users: number; agents: number }; openInvoices: number; billingExempt: boolean; providers: string[] };
type Plan = { key: string; name: string; description: string; priceMonthlyCents: number; priceYearlyCents: number; currency: string; trialDays: number; limits: Record<string, number>; features: string[] };
type Invoice = { id: string; number: string; status: string; totalCents: number; currency: string; dueAt: string; paidAt: string | null; periodStart: string | null; periodEnd: string | null; createdAt: string; payments: { provider: string; reference: string | null; amountCents: number }[] };
const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "primary"> = { ACTIVE: "success", TRIALING: "primary", GRACE: "warning", PAST_DUE: "warning", EXPIRED: "danger", CANCELED: "danger", SUSPENDED: "danger", EXEMPT: "neutral" };

function BillingPageInner() {
  const { can } = useWorkspace();
  const toast = useToast();
  const sp = useSearchParams();
  const sub = useApi<Sub>("/api/v1/subscriptions");
  const plans = useApi<{ plans: Plan[] }>("/api/v1/subscriptions/plans");
  const invoices = useApi<{ rows: Invoice[] }>("/api/v1/invoices");
  const [choose, setChoose] = useState(false);
  const [interval, setInterval_] = useState<"MONTHLY" | "YEARLY">("MONTHLY");
  const [busy, setBusy] = useState<string | null>(null);
  const s = sub.data?.subscription;
  async function change(planKey: string) {
    setBusy(planKey);
    try {
      const r = await api.post<{ message: string }>("/api/v1/subscriptions/change", { planKey, interval });
      toast.success("Plan updated", r.message);
      setChoose(false);
      sub.refresh();
      invoices.refresh();
    } catch (err) {
      toast.error("Could not change plan", err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }
  async function pay(inv: Invoice) {
    setBusy(inv.id);
    try {
      const r = await api.post<{ url: string }>(`/api/v1/invoices/${inv.id}/pay`, { provider: "stripe" });
      window.location.href = r.url;
    } catch (err) {
      toast.error("Online payment unavailable", err instanceof ApiError ? err.message : undefined);
      setBusy(null);
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Subscription & Billing" description="Plan, limits, invoices and payment history." actions={can("billing.manage") && !sub.data?.billingExempt ? <Button onClick={() => setChoose(true)}>Change plan</Button> : null} />
      {sp.get("paid") ? <Alert tone="success">Thank you! Invoice {sp.get("paid")} will be marked paid as soon as the payment provider confirms it.</Alert> : null}
      {sub.loading ? <LoadingBlock rows={3} /> : sub.data?.billingExempt ? <Alert tone="info" title="Internal business workspace">This workspace is billing-exempt. Usage is still recorded and plan limits still apply.</Alert> : null}
      {s ? (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title={<span className="flex items-center gap-2">{s.plan.name} plan <Badge tone={TONE[s.status]}>{s.status.toLowerCase().replace("_", " ")}</Badge></span>} description={s.status === "TRIALING" && s.trialEndsAt ? `Trial ends ${formatDate(s.trialEndsAt)}` : s.status === "GRACE" && s.graceEndsAt ? `Payment due before ${formatDate(s.graceEndsAt)} to avoid interruption` : s.cancelAtPeriodEnd ? `Cancels on ${formatDate(s.currentPeriodEnd)}` : `Renews ${formatDate(s.currentPeriodEnd)}`} />
            <KeyValue items={[{ k: "Price", v: sub.data?.billingExempt ? "Exempt" : `${formatMoney(s.interval === "YEARLY" ? s.plan.priceYearlyCents : s.plan.priceMonthlyCents, s.plan.currency)} / ${s.interval === "YEARLY" ? "year" : "month"}${s.discountPercent ? ` (−${s.discountPercent}%)` : ""}` }, { k: "Current period", v: `${formatDate(s.currentPeriodStart)} → ${formatDate(s.currentPeriodEnd)}` }, { k: "Pages", v: `${sub.data!.counts.pages} / ${sub.data!.limits.pages}` }, { k: "Team members", v: `${sub.data!.counts.users} / ${sub.data!.limits.users}` }, { k: "AI agents", v: `${sub.data!.counts.agents} / ${sub.data!.limits.agents}` }, { k: "Comments / month", v: sub.data!.limits.commentsPerMonth.toLocaleString() }, { k: "AI requests / month", v: sub.data!.limits.aiRequestsPerMonth.toLocaleString() }]} />
            {can("billing.manage") && !sub.data?.billingExempt ? <div className="mt-4 flex gap-2">{s.cancelAtPeriodEnd ? <Button variant="outline" onClick={() => api.post("/api/v1/subscriptions/cancel", { cancel: false }).then(() => sub.refresh())}>Keep subscription</Button> : <Button variant="ghost" className="text-danger" onClick={() => confirm("Cancel at the end of the current period?") && api.post("/api/v1/subscriptions/cancel", { cancel: true }).then(() => sub.refresh())}>Cancel at period end</Button>}</div> : null}
          </Card>
          <Card><CardHeader title="Payment methods" /><p className="text-sm text-text-2">{sub.data?.providers.includes("stripe") ? "Pay invoices online by card through secure hosted checkout, or by bank transfer / bKash — confirmed by our team." : "Pay by bank transfer or bKash. Send the reference to support and the invoice is marked paid after confirmation."}</p>{sub.data?.openInvoices ? <Alert tone="warning" className="mt-3">{sub.data.openInvoices} open invoice{sub.data.openInvoices > 1 ? "s" : ""}</Alert> : null}</Card>
        </div>
      ) : null}
      <Card padded={false}>
        <div className="p-5 pb-0"><CardHeader title="Billing history" /></div>
        {invoices.loading ? <div className="p-5"><LoadingBlock /></div> : (
          <Table className="rounded-none border-0 shadow-none">
            <thead><tr><Th>Invoice</Th><Th>Period</Th><Th>Amount</Th><Th>Due</Th><Th>Status</Th><Th></Th></tr></thead>
            <tbody>{invoices.data?.rows.map((inv) => <tr key={inv.id}><Td className="font-medium">{inv.number}</Td><Td className="text-text-2">{inv.periodStart ? `${formatDate(inv.periodStart)} → ${formatDate(inv.periodEnd)}` : "—"}</Td><Td>{formatMoney(inv.totalCents, inv.currency)}</Td><Td className="text-text-2">{formatDate(inv.dueAt)}</Td><Td><Badge tone={inv.status === "PAID" ? "success" : inv.status === "OPEN" ? (new Date(inv.dueAt) < new Date() ? "danger" : "warning") : "neutral"}>{inv.status.toLowerCase()}{inv.paidAt ? ` · ${formatDate(inv.paidAt)}` : ""}</Badge>{inv.payments[0] ? <div className="text-[11px] text-text-3">{inv.payments[0].provider}{inv.payments[0].reference ? ` · ${inv.payments[0].reference}` : ""}</div> : null}</Td><Td>{inv.status === "OPEN" && can("billing.manage") && sub.data?.providers.includes("stripe") ? <Button size="sm" loading={busy === inv.id} onClick={() => pay(inv)}><CreditCard className="h-4 w-4" /> Pay</Button> : null}</Td></tr>)}{!invoices.data?.rows.length ? <tr><Td colSpan={6} className="py-8 text-center text-text-3">No invoices yet</Td></tr> : null}</tbody>
          </Table>
        )}
      </Card>
      <Dialog open={choose} onClose={() => setChoose(false)} title="Choose a plan" description="Upgrades apply immediately once the invoice is paid; downgrades apply at the next renewal." size="xl">
        <div className="mb-4 flex gap-2">{(["MONTHLY", "YEARLY"] as const).map((i) => <Button key={i} size="sm" variant={interval === i ? "soft" : "outline"} onClick={() => setInterval_(i)}>{i === "MONTHLY" ? "Monthly" : "Yearly (2 months free)"}</Button>)}</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {plans.data?.plans.map((p) => {
            const price = interval === "YEARLY" ? p.priceYearlyCents : p.priceMonthlyCents;
            const current = s?.plan.key === p.key;
            return (
              <div key={p.key} className={`flex flex-col rounded-card border p-4 ${current ? "border-primary bg-primary-soft/30" : "border-border"}`}>
                <div className="text-[13px] font-semibold text-text">{p.name}</div>
                <div className="mt-1 text-xl font-semibold text-text">{price ? formatMoney(price, p.currency) : "Custom"}</div>
                <ul className="mt-3 space-y-1 text-[12px] text-text-2"><li>{p.limits.pages} Pages · {p.limits.users} users · {p.limits.agents} agents</li><li>{p.limits.commentsPerMonth.toLocaleString()} comments/mo</li><li>{p.limits.aiRequestsPerMonth.toLocaleString()} AI requests/mo</li>{p.features.slice(0, 3).map((f) => <li key={f} className="flex gap-1"><Check className="h-3 w-3 text-success" />{f}</li>)}</ul>
                <Button size="sm" className="mt-4" disabled={current || !price} loading={busy === p.key} onClick={() => change(p.key)}>{current ? "Current plan" : price ? "Select" : "Contact sales"}</Button>
              </div>
            );
          })}
        </div>
      </Dialog>
    </div>
  );
}

export default function BillingPage() {
  return <Suspense fallback={<div className="skeleton h-64 rounded-card" />}><BillingPageInner /></Suspense>;
}
