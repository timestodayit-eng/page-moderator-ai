"use client";
import { Badge, Card, CardHeader, KeyValue, LoadingBlock, PageHeader } from "@/components/ui";
import { useApi, usePolling } from "@/lib/hooks";
import { timeAgo } from "@/lib/utils";

type Health = { status: string; checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }>; version: string; time: string };
type Overview = { system: { webhookFailures: number; outboundQueue: Record<string, number>; outboxPending: number; worker: { alive: boolean; lastHeartbeat: string | null; queues: Record<string, { waiting: number; active: number; failed: number; delayed: number } | string> | null } } };

export default function HealthPage() {
  const h = useApi<Health>("/api/health");
  const o = useApi<Overview>("/api/v1/platform/overview");
  usePolling(() => { h.refresh(); o.refresh(); }, 15000);
  if (!h.data || !o.data) return <LoadingBlock rows={4} />;
  return (
    <div className="space-y-5">
      <PageHeader title="System Health" description={`Version ${h.data.version} · checked ${timeAgo(h.data.time)} · refreshes every 15s`} />
      <div className="grid gap-4 sm:grid-cols-3">{Object.entries(h.data.checks).map(([k, c]) => <Card key={k}><div className="flex items-center justify-between"><span className="text-[15px] font-semibold capitalize text-text">{k}</span><Badge tone={c.ok ? "success" : "danger"}>{c.ok ? "ok" : "down"}</Badge></div><div className="mt-1 text-[13px] text-text-2">{c.latencyMs !== undefined ? `${c.latencyMs} ms` : c.error ?? ""}</div></Card>)}</div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardHeader title="Queues" description={o.data.system.worker.lastHeartbeat ? `Worker heartbeat ${timeAgo(o.data.system.worker.lastHeartbeat)}` : "No worker heartbeat"} />{o.data.system.worker.queues ? <KeyValue items={Object.entries(o.data.system.worker.queues).map(([q, c]) => ({ k: q, v: typeof c === "string" ? c : <span className={c.failed ? "text-danger" : ""}>{c.waiting} waiting · {c.active} active · {c.delayed} delayed · {c.failed} failed</span> }))} /> : <p className="text-sm text-text-3">—</p>}</Card>
        <Card><CardHeader title="Pipelines" /><KeyValue items={[{ k: "Outbox pending", v: o.data.system.outboxPending }, { k: "Webhook events failed", v: o.data.system.webhookFailures }, ...Object.entries(o.data.system.outboundQueue).map(([k, v]) => ({ k: `Outbound ${k.toLowerCase()}`, v }))]} /></Card>
      </div>
    </div>
  );
}
