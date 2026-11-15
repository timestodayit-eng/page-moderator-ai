"use client";
import { Building2, CreditCard, Cpu, Globe, MessageSquare, ShieldCheck, Activity, AlertTriangle, Users } from "lucide-react";
import { Alert, Badge, Card, CardHeader, KeyValue, LoadingBlock, PageHeader, Stat } from "@/components/ui";
import { useApi, usePolling } from "@/lib/hooks";
import { formatMicroUsd, formatMoney, formatNumber, timeAgo } from "@/lib/utils";

type Overview = { businesses: { total: number; active: number; pending: number; suspended: number }; subscriptions: { active: number; trial: number; expired: number; pastDue: number; exempt: number }; revenue: { monthCents: number; pendingInvoiceCents: number; pendingInvoices: number }; ai: { costMicroUsd: number; requests: number; tokens: number }; moderation: { pages: number; commentsTotal: number; commentsMonth: number; autoHidden: number; aiReplies: number; conversationsMonth: number }; system: { activeUsers24h: number; webhookFailures: number; outboundQueue: Record<string, number>; outboxPending: number; worker: { alive: boolean; lastHeartbeat: string | null; queues: Record<string, { waiting: number; active: number; failed: number; delayed: number } | string> | null } } };

export default function PlatformOverview() {
  const d = useApi<Overview>("/api/v1/platform/overview");
  usePolling(() => d.refresh(), 30000);
  const x = d.data;
  if (!x) return <LoadingBlock rows={6} />;
  return (
    <div className="space-y-6">
      <PageHeader title="Platform Overview" description="Live view of customers, revenue, AI costs, moderation volume and system health." />
      {!x.system.worker.alive ? <Alert tone="danger" title="Background worker is not running">No heartbeat {x.system.worker.lastHeartbeat ? `since ${timeAgo(x.system.worker.lastHeartbeat)}` : "received yet"}. Webhooks, moderation, emails and billing jobs are queued but not processed. Check the worker container logs.</Alert> : null}
      {x.system.webhookFailures ? <Alert tone="warning">{x.system.webhookFailures} webhook events failed processing and will be replayed automatically.</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Registered businesses" value={x.businesses.total} sub={`${x.businesses.active} active · ${x.businesses.pending} pending · ${x.businesses.suspended} suspended`} icon={<Building2 className="h-5 w-5" />} tone="primary" />
        <Stat label="Subscriptions" value={x.subscriptions.active} sub={`${x.subscriptions.trial} trial · ${x.subscriptions.pastDue} past due · ${x.subscriptions.expired} expired · ${x.subscriptions.exempt} exempt`} icon={<CreditCard className="h-5 w-5" />} tone="success" />
        <Stat label="Revenue this month" value={formatMoney(x.revenue.monthCents)} sub={`${x.revenue.pendingInvoices} pending invoices (${formatMoney(x.revenue.pendingInvoiceCents)})`} icon={<Activity className="h-5 w-5" />} />
        <Stat label="AI processing cost (month)" value={formatMicroUsd(x.ai.costMicroUsd)} sub={`${formatNumber(x.ai.requests)} requests · ${formatNumber(x.ai.tokens)} tokens`} icon={<Cpu className="h-5 w-5" />} tone="warning" />
        <Stat label="Facebook Pages connected" value={x.moderation.pages} icon={<Globe className="h-5 w-5" />} />
        <Stat label="Comments processed" value={formatNumber(x.moderation.commentsTotal)} sub={`${formatNumber(x.moderation.commentsMonth)} this month`} icon={<ShieldCheck className="h-5 w-5" />} />
        <Stat label="Auto-hidden · AI replies" value={`${x.moderation.autoHidden} · ${x.moderation.aiReplies}`} icon={<AlertTriangle className="h-5 w-5" />} tone="danger" />
        <Stat label="Messenger conversations (month)" value={x.moderation.conversationsMonth} sub={`${x.system.activeUsers24h} active users (24h)`} icon={<MessageSquare className="h-5 w-5" />} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardHeader title="Worker & queues" description={x.system.worker.lastHeartbeat ? `Heartbeat ${timeAgo(x.system.worker.lastHeartbeat)}` : "No heartbeat"} action={<Badge tone={x.system.worker.alive ? "success" : "danger"}>{x.system.worker.alive ? "healthy" : "down"}</Badge>} />{x.system.worker.queues ? <KeyValue items={Object.entries(x.system.worker.queues).map(([q, c]) => ({ k: q, v: typeof c === "string" ? c : `${c.waiting} waiting · ${c.active} active · ${c.delayed} delayed · ${c.failed} failed` }))} /> : <p className="text-sm text-text-3">Queue stats appear once the worker reports.</p>}</Card>
        <Card><CardHeader title="Outbound actions & outbox" /><KeyValue items={[...Object.entries(x.system.outboundQueue).map(([k, v]) => ({ k: `Actions ${k.toLowerCase()}`, v })), { k: "Outbox pending", v: x.system.outboxPending }, { k: "Webhook failures", v: x.system.webhookFailures }, { k: "Active users (24h)", v: <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{x.system.activeUsers24h}</span> }]} /></Card>
      </div>
    </div>
  );
}
