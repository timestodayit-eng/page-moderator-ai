"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { Button, Card, CardHeader, LoadingBlock, PageHeader, Select, Stat } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { formatMicroUsd, pct } from "@/lib/utils";
import { Bars, Donut, Sparkline } from "@/components/app/charts";
import { CATEGORY_LABEL } from "@/components/app/moderation-shared";

type Data = { days: number; moderation: { total: number; categories: Record<string, number>; negative: number; harmful: number; spam: number; autoHidden: number; falsePositiveRate: number; awaitingReview: number; daily: { day: string; total: number; hidden: number; harmful: number }[] }; support: { conversations: number; firstResponseSeconds: number | null; resolutionSeconds: number | null; aiAssistedReplies: number; byEmployee: { name: string; conversations: number }[] }; crm: { newLeads: number; qualified: number; converted: number; conversionRate: number; bySource: Record<string, number>; byEmployee: { name: string; leads: number }[]; followUpActivities: number }; business: { pages: number; aiRequests: number; aiCostMicroUsd: number }; daily: { day: string; comments: number; conversations: number; leads: number; aiRequests: number }[] };
const dur = (s: number | null) => (s === null ? "—" : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} d`);

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const d = useApi<Data>(`/api/v1/analytics?days=${days}`);
  const x = d.data;
  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="Moderation, customer support, CRM and business metrics for this workspace." actions={<><Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-36"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></Select><a href={`/api/v1/analytics?days=${days}&format=csv`}><Button variant="outline"><Download className="h-4 w-4" /> CSV</Button></a></>} />
      {!x ? <LoadingBlock rows={5} /> : (
        <>
          <section className="space-y-4">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-text-3">Moderation</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Comment volume" value={x.moderation.total} /><Stat label="Negative sentiment" value={x.moderation.negative} sub="complaints + negative" tone="warning" /><Stat label="Harmful detected" value={x.moderation.harmful + x.moderation.spam} sub={`${x.moderation.autoHidden} hidden automatically`} tone="danger" /><Stat label="False-positive rate" value={pct(x.moderation.falsePositiveRate, 1)} sub={`${x.moderation.awaitingReview} awaiting review`} tone="success" /></div>
            <div className="grid gap-5 lg:grid-cols-3"><Card className="lg:col-span-2"><CardHeader title="Daily volume" /><Sparkline series={[{ name: "Comments", color: "var(--primary)", values: x.daily.map((r) => r.comments) }, { name: "Conversations", color: "var(--success)", values: x.daily.map((r) => r.conversations) }, { name: "Leads", color: "var(--warning)", values: x.daily.map((r) => r.leads) }]} labels={x.daily.map((r) => r.day.slice(5))} /></Card><Card><CardHeader title="Categories" /><Bars data={Object.entries(x.moderation.categories).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ label: CATEGORY_LABEL[k] ?? k, value: v }))} /></Card></div>
          </section>
          <section className="space-y-4">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-text-3">Customer support</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Conversations" value={x.support.conversations} /><Stat label="First response" value={dur(x.support.firstResponseSeconds)} sub="average" /><Stat label="Resolution time" value={dur(x.support.resolutionSeconds)} sub="average" /><Stat label="AI-assisted replies" value={x.support.aiAssistedReplies} /></div>
            <Card><CardHeader title="Employee performance" description="Conversations handled per team member." /><Bars data={x.support.byEmployee.map((e) => ({ label: e.name, value: e.conversations }))} color="var(--success)" /></Card>
          </section>
          <section className="space-y-4">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-text-3">CRM</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="New leads" value={x.crm.newLeads} /><Stat label="Qualified" value={x.crm.qualified} /><Stat label="Converted" value={x.crm.converted} sub={`Conversion ${pct(x.crm.conversionRate, 1)}`} tone="success" /><Stat label="Follow-up activities" value={x.crm.followUpActivities} /></div>
            <div className="grid gap-5 lg:grid-cols-2"><Card><CardHeader title="Lead source" /><Donut parts={Object.entries(x.crm.bySource).map(([k, v], i) => ({ label: k.toLowerCase(), value: v, color: ["var(--primary)", "var(--success)", "var(--warning)", "var(--danger)", "var(--border-strong)"][i % 5] }))} /></Card><Card><CardHeader title="Assignments" /><Bars data={x.crm.byEmployee.map((e) => ({ label: e.name, value: e.leads }))} color="var(--warning)" /></Card></div>
          </section>
          <section className="space-y-4">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-text-3">Business</h2>
            <div className="grid gap-4 sm:grid-cols-3"><Stat label="Connected Pages" value={x.business.pages} /><Stat label="AI requests" value={x.business.aiRequests} /><Stat label="AI cost" value={formatMicroUsd(x.business.aiCostMicroUsd)} /></div>
          </section>
        </>
      )}
    </div>
  );
}
