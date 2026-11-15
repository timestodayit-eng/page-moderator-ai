"use client";
import { Card, CardHeader, LoadingBlock, PageHeader, Progress, Table, Td, Th } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { formatMicroUsd, formatNumber } from "@/lib/utils";
import { Sparkline } from "@/components/app/charts";

type Data = { period: string; limits: Record<string, number> & { subscriptionStatus: string; serviceActive: boolean }; usage: Record<string, number>; byProvider: { provider: string; model: string; credentialMode: string; _count: number; _sum: { tokensIn: number; tokensOut: number; costMicroUsd: number } }[]; byAgent: { agentId: string | null; purpose: string; _count: number; _sum: { costMicroUsd: number } }[]; daily: { day: string; requests: number; costMicroUsd: number }[] };

export default function UsagePage() {
  const d = useApi<Data>("/api/v1/usage");
  const x = d.data;
  const rows = x ? [
    ["Comments processed", x.usage.COMMENTS_PROCESSED ?? 0, x.limits.commentsPerMonth],
    ["AI requests", x.usage.AI_REQUEST ?? 0, x.limits.aiRequestsPerMonth],
    ["AI cost (platform-managed)", x.usage.AI_COST_MICROUSD ?? 0, x.limits.aiBudgetMicroUsd, "money"],
    ["Automated replies", x.usage.AUTO_REPLY ?? 0, x.limits.autoRepliesPerMonth],
    ["Automated hides", x.usage.AUTO_HIDE ?? 0, null],
    ["Storage", (x.usage.STORAGE_BYTES ?? 0) / 1024 / 1024, x.limits.storageMb, "mb"],
  ] as const : [];
  return (
    <div className="space-y-6">
      <PageHeader title="Usage" description={x ? `Billing period ${x.period} · plan status ${x.limits.subscriptionStatus.toLowerCase()}` : undefined} />
      {!x ? <LoadingBlock rows={4} /> : (
        <>
          <Card>
            <CardHeader title="Subscription consumption" description="Counters reset at the start of each month. Hard limits pause automated AI processing until the next cycle or an upgrade." />
            <div className="space-y-4">
              {rows.map(([label, used, limit, kind]) => (
                <div key={label}>
                  <div className="mb-1 flex justify-between text-[13px]"><span className="text-text-2">{label}</span><span className="font-medium text-text">{kind === "money" ? formatMicroUsd(used) : kind === "mb" ? `${used.toFixed(1)} MB` : formatNumber(used)}{limit !== null ? <span className="text-text-3"> / {kind === "money" ? formatMicroUsd(limit) : kind === "mb" ? `${limit} MB` : formatNumber(limit)}</span> : null}</span></div>
                  {limit !== null ? <Progress value={used} max={limit} /> : null}
                </div>
              ))}
            </div>
          </Card>
          <Card><CardHeader title="AI requests & cost (30 days)" /><Sparkline series={[{ name: "Requests", color: "var(--primary)", values: x.daily.map((r) => r.requests) }, { name: "Cost (¢)", color: "var(--warning)", values: x.daily.map((r) => Math.round(r.costMicroUsd / 10_000)) }]} labels={x.daily.map((r) => r.day.slice(5))} /></Card>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card padded={false}><div className="p-5 pb-0"><CardHeader title="By provider & model" /></div><Table className="rounded-none border-0 shadow-none"><thead><tr><Th>Provider</Th><Th>Model</Th><Th>Mode</Th><Th>Requests</Th><Th>Tokens</Th><Th>Cost</Th></tr></thead><tbody>{x.byProvider.map((p, i) => <tr key={i}><Td>{p.provider}</Td><Td className="text-text-2">{p.model}</Td><Td>{p.credentialMode}</Td><Td>{p._count}</Td><Td>{formatNumber((p._sum.tokensIn ?? 0) + (p._sum.tokensOut ?? 0))}</Td><Td>{formatMicroUsd(p._sum.costMicroUsd ?? 0)}</Td></tr>)}{!x.byProvider.length ? <tr><Td colSpan={6} className="text-center text-text-3">No AI usage this period</Td></tr> : null}</tbody></Table></Card>
            <Card padded={false}><div className="p-5 pb-0"><CardHeader title="By purpose" /></div><Table className="rounded-none border-0 shadow-none"><thead><tr><Th>Purpose</Th><Th>Agent</Th><Th>Requests</Th><Th>Cost</Th></tr></thead><tbody>{x.byAgent.map((a, i) => <tr key={i}><Td>{a.purpose}</Td><Td className="text-text-2">{a.agentId ? a.agentId.slice(-6) : "default"}</Td><Td>{a._count}</Td><Td>{formatMicroUsd(a._sum.costMicroUsd ?? 0)}</Td></tr>)}{!x.byAgent.length ? <tr><Td colSpan={4} className="text-center text-text-3">No AI usage this period</Td></tr> : null}</tbody></Table></Card>
          </div>
        </>
      )}
    </div>
  );
}
