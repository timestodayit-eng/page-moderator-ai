"use client";
import { Card, CardHeader, LoadingBlock, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { formatMicroUsd, formatNumber } from "@/lib/utils";
import { Sparkline } from "@/components/app/charts";

type Data = { month: { costMicroUsd: number; requests: number; tokens: number; failures: number; platformCost: number; byokCost: number }; budget: { capMicroUsd: number | null }; byWorkspace: { workspaceId: string; name: string; requests: number; costMicroUsd: number; mode: string }[]; byProvider: { provider: string; model: string; requests: number; costMicroUsd: number; failures: number }[]; daily: { day: string; requests: number; costMicroUsd: number; failures: number }[] };

export default function AiUsagePage() {
  const d = useApi<Data>("/api/v1/platform/ai-usage");
  const x = d.data;
  if (!x) return <LoadingBlock rows={5} />;
  return (
    <div className="space-y-6">
      <PageHeader title="AI Usage & Costs" description="Platform-wide AI processing, per business and provider. Platform-managed spend counts toward the monthly budget in Platform Settings." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Cost this month" value={formatMicroUsd(x.month.costMicroUsd)} sub={x.budget.capMicroUsd ? `Platform budget ${formatMicroUsd(x.budget.capMicroUsd)} · platform-paid ${formatMicroUsd(x.month.platformCost)}` : `platform-paid ${formatMicroUsd(x.month.platformCost)} · BYOK ${formatMicroUsd(x.month.byokCost)}`} tone="warning" /><Stat label="Requests" value={formatNumber(x.month.requests)} /><Stat label="Tokens" value={formatNumber(x.month.tokens)} /><Stat label="Failures" value={x.month.failures} tone={x.month.failures ? "danger" : "success"} /></div>
      <Card><CardHeader title="Daily (30 days)" /><Sparkline series={[{ name: "Requests", color: "var(--primary)", values: x.daily.map((r) => r.requests) }, { name: "Cost (¢)", color: "var(--warning)", values: x.daily.map((r) => Math.round(r.costMicroUsd / 10_000)) }, { name: "Failures", color: "var(--danger)", values: x.daily.map((r) => r.failures) }]} labels={x.daily.map((r) => r.day.slice(5))} /></Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card padded={false}><div className="p-5 pb-0"><CardHeader title="By business" /></div><Table className="rounded-none border-0 shadow-none"><thead><tr><Th>Business</Th><Th>Mode</Th><Th>Requests</Th><Th>Cost</Th></tr></thead><tbody>{x.byWorkspace.map((w) => <tr key={w.workspaceId}><Td><a href={`/admin/customers/${w.workspaceId}`} className="text-primary">{w.name}</a></Td><Td>{w.mode}</Td><Td>{formatNumber(w.requests)}</Td><Td>{formatMicroUsd(w.costMicroUsd)}</Td></tr>)}</tbody></Table></Card>
        <Card padded={false}><div className="p-5 pb-0"><CardHeader title="By provider & model" /></div><Table className="rounded-none border-0 shadow-none"><thead><tr><Th>Provider</Th><Th>Model</Th><Th>Requests</Th><Th>Failures</Th><Th>Cost</Th></tr></thead><tbody>{x.byProvider.map((p, i) => <tr key={i}><Td>{p.provider}</Td><Td className="text-text-2">{p.model}</Td><Td>{formatNumber(p.requests)}</Td><Td className={p.failures ? "text-danger" : ""}>{p.failures}</Td><Td>{formatMicroUsd(p.costMicroUsd)}</Td></tr>)}</tbody></Table></Card>
      </div>
    </div>
  );
}
