"use client";
import Link from "next/link";
import { ShieldCheck, MessageSquare, KanbanSquare, Bot, AlertTriangle, ArrowRight, Globe } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, LoadingBlock, PageHeader, Stat } from "@/components/ui";
import { useWorkspace } from "@/components/app/workspace-context";
import { useApi } from "@/lib/hooks";
import { formatMicroUsd, formatNumber, pct, timeAgo } from "@/lib/utils";
import { Sparkline } from "@/components/app/charts";

type Stats = { total: number; positive: number; negative: number; complaints: number; spam: number; harmful: number; autoHidden: number; awaitingReview: number; manualOverrides: number; falsePositiveRate: number; daily: { day: string; total: number; hidden: number; harmful: number }[] };
type Pages = { pages: { id: string; name: string; status: string; moderationMode: string; autoHideEnabled: boolean; killSwitch: boolean; webhookSubscribed: boolean; healthError: string | null; _count: { comments: number; conversations: number } }[]; metaConfigured: boolean };
type Usage = { limits: Record<string, number> & { serviceActive: boolean; subscriptionStatus: string }; usage: Record<string, number> };

export default function Overview() {
  const { workspace, can } = useWorkspace();
  const base = `/app/${workspace.slug}`;
  const stats = useApi<Stats>(can("comments.read") ? "/api/v1/moderation/stats?days=30" : null);
  const pages = useApi<Pages>("/api/v1/pages");
  const usage = useApi<Usage>(can("billing.view") ? "/api/v1/usage" : null);
  const review = useApi<{ total: number; rows: { id: string; message: string; authorName: string | null; createdTime: string; page: { name: string }; classifications: { category: string; confidence: number }[]; decisions: { id: string; decision: string }[] }[] }>(can("comments.read") ? "/api/v1/comments?review=PENDING&pageSize=5" : null);
  const connected = pages.data?.pages.filter((p) => p.status !== "DISCONNECTED") ?? [];
  const unhealthy = connected.filter((p) => p.status !== "CONNECTED" || !p.webhookSubscribed);

  return (
    <div className="space-y-6">
      <PageHeader title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}`} description={`Here is what is happening across ${workspace.name}.`} actions={can("pages.manage") ? <Link href={`${base}/pages`}><Button variant="outline"><Globe className="h-4 w-4" /> Manage Pages</Button></Link> : null} />
      {pages.data && !pages.data.metaConfigured ? <Alert tone="warning" title="Facebook integration is not configured on this server">Set META_APP_ID and META_APP_SECRET, then restart. See README → Meta App integration.</Alert> : null}
      {unhealthy.length ? <Alert tone="danger" title={`${unhealthy.length} Page${unhealthy.length > 1 ? "s need" : " needs"} attention`}>{unhealthy.map((p) => `${p.name}: ${p.healthError ?? (p.status !== "CONNECTED" ? p.status.toLowerCase().replace("_", " ") : "webhook not verified")}`).join(" · ")} <Link href={`${base}/pages`} className="font-medium text-primary">Fix now</Link></Alert> : null}
      {usage.data && !usage.data.limits.serviceActive ? <Alert tone="danger" title="Subscription inactive">Automated moderation and replies are paused. <Link href={`${base}/billing`} className="font-medium text-primary">Review billing</Link></Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Comments analysed (30d)" value={stats.data ? formatNumber(stats.data.total) : "—"} sub={stats.data ? `${stats.data.positive} positive · ${stats.data.negative} negative` : undefined} icon={<ShieldCheck className="h-5 w-5" />} tone="primary" />
        <Stat label="Awaiting review" value={stats.data ? stats.data.awaitingReview : "—"} sub="AI decisions needing a human" icon={<AlertTriangle className="h-5 w-5" />} tone={stats.data?.awaitingReview ? "warning" : "success"} />
        <Stat label="Auto-hidden" value={stats.data ? stats.data.autoHidden : "—"} sub={stats.data ? `False-positive rate ${pct(stats.data.falsePositiveRate, 1)}` : undefined} icon={<Bot className="h-5 w-5" />} tone="danger" />
        <Stat label="AI cost this month" value={usage.data ? formatMicroUsd(usage.data.usage.AI_COST_MICROUSD ?? 0) : "—"} sub={usage.data ? `${formatNumber(usage.data.usage.AI_REQUEST ?? 0)} / ${formatNumber(usage.data.limits.aiRequestsPerMonth)} requests` : undefined} icon={<KanbanSquare className="h-5 w-5" />} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Comment volume" description="Daily comments, harmful detections and hidden comments (last 30 days)." />
          {stats.loading ? <LoadingBlock rows={3} /> : stats.data?.daily.length ? <Sparkline series={[{ name: "Comments", color: "var(--primary)", values: stats.data.daily.map((d) => d.total) }, { name: "Harmful", color: "var(--warning)", values: stats.data.daily.map((d) => d.harmful) }, { name: "Hidden", color: "var(--danger)", values: stats.data.daily.map((d) => d.hidden) }]} labels={stats.data.daily.map((d) => d.day.slice(5))} height={220} /> : <EmptyState title="No comments yet" description="Connect a Facebook Page and comments will appear here as they arrive." />}
        </Card>
        <Card>
          <CardHeader title="Connected Pages" action={<Link href={`${base}/pages`} className="text-[13px] font-medium text-primary">All</Link>} />
          {pages.loading ? <LoadingBlock rows={3} /> : connected.length ? (
            <ul className="space-y-3">
              {connected.slice(0, 6).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text">{p.name}</div>
                    <div className="text-[12px] text-text-3">{p._count.comments} comments · {p._count.conversations} chats</div>
                  </div>
                  <Badge tone={p.killSwitch ? "danger" : p.moderationMode === "AUTO" && p.autoHideEnabled ? "success" : p.moderationMode === "APPROVAL" ? "primary" : "neutral"}>{p.killSwitch ? "Paused" : p.moderationMode === "AUTO" && p.autoHideEnabled ? "Auto" : p.moderationMode === "APPROVAL" ? "Approval" : "Shadow"}</Badge>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No Pages connected" action={can("pages.manage") ? <Link href={`${base}/pages`}><Button size="sm">Connect a Page</Button></Link> : undefined} />}
        </Card>
      </div>

      {can("comments.read") ? (
        <Card>
          <CardHeader title="Review queue" description="Latest AI decisions waiting for approval." action={<Link href={`${base}/moderation/review`} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary">Open queue <ArrowRight className="h-3.5 w-3.5" /></Link>} />
          {review.loading ? <LoadingBlock rows={3} /> : review.data?.rows.length ? (
            <ul className="divide-y divide-border">
              {review.data.rows.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <Link href={`${base}/moderation/${c.id}`} className="line-clamp-2 font-bengali text-sm text-text hover:text-primary">{c.message}</Link>
                    <div className="mt-1 text-[12px] text-text-3">{c.authorName ?? "Unknown"} · {c.page.name} · {timeAgo(c.createdTime)}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={["SPAM", "SCAM", "ABUSE", "HARASSMENT", "HATE_SPEECH", "HIGH_RISK", "SUSPICIOUS_LINK", "REPEATED_PROMO", "PII_EXPOSURE"].includes(c.classifications[0]?.category) ? "danger" : c.classifications[0]?.category === "COMPLAINT" ? "warning" : "neutral"}>{c.classifications[0]?.category ?? "—"}</Badge>
                    <span className="text-[11px] text-text-3">Suggests {c.decisions[0]?.decision}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="Queue is empty" description="Nothing is waiting for review." className="py-8" />}
        </Card>
      ) : null}
      {can("inbox.manage") ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Link href={`${base}/inbox`} className="group flex items-center justify-between rounded-card border border-border bg-surface p-5 shadow-soft transition-colors hover:border-primary/40"><span className="flex items-center gap-3 text-sm font-medium text-text"><MessageSquare className="h-5 w-5 text-primary" /> Open Messenger inbox</span><ArrowRight className="h-4 w-4 text-text-3 transition-transform group-hover:translate-x-0.5" /></Link>
          <Link href={`${base}/crm`} className="group flex items-center justify-between rounded-card border border-border bg-surface p-5 shadow-soft transition-colors hover:border-primary/40"><span className="flex items-center gap-3 text-sm font-medium text-text"><KanbanSquare className="h-5 w-5 text-primary" /> Go to CRM pipeline</span><ArrowRight className="h-4 w-4 text-text-3 transition-transform group-hover:translate-x-0.5" /></Link>
        </div>
      ) : null}
    </div>
  );
}
