"use client";
import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, EyeOff, AlertTriangle, ThumbsUp, Undo2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, LoadingBlock, PageHeader, Pagination, SearchInput, Select, Stat, Table, Td, Th, Tabs } from "@/components/ui";
import { useWorkspace } from "@/components/app/workspace-context";
import { useApi, useDebounced } from "@/lib/hooks";
import { pct, timeAgo } from "@/lib/utils";
import { Donut, Sparkline } from "@/components/app/charts";
import { CATEGORY_LABEL, CategoryBadge, Confidence, DecisionBadge } from "@/components/app/moderation-shared";

type Stats = { total: number; categories: Record<string, number>; positive: number; negative: number; complaints: number; spam: number; harmful: number; autoHidden: number; awaitingReview: number; manualOverrides: number; falsePositiveRate: number; daily: { day: string; total: number; hidden: number; harmful: number }[] };
type Row = { id: string; message: string; authorName: string | null; createdTime: string; isHidden: boolean; status: string; page: { id: string; name: string }; classifications: { category: string; confidence: number; language: string }[]; decisions: { decision: string; autoExecuted: boolean; reviewStatus: string }[] };

export default function ModerationDashboard() {
  const { workspace, can } = useWorkspace();
  const base = `/app/${workspace.slug}`;
  const [pageId, setPageId] = useState("");
  const [tab, setTab] = useState<"all" | "hidden" | "harmful" | "review">("all");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const pages = useApi<{ pages: { id: string; name: string; status: string }[] }>("/api/v1/pages");
  const stats = useApi<Stats>(`/api/v1/moderation/stats?days=30${pageId ? `&pageId=${pageId}` : ""}`);
  const filter = tab === "hidden" ? "&hidden=true" : tab === "review" ? "&review=PENDING" : "";
  const list = useApi<{ total: number; rows: Row[]; pageSize: number }>(`/api/v1/comments?page=${page}&pageSize=25${filter}${pageId ? `&pageId=${pageId}` : ""}${category ? `&category=${category}` : ""}${q ? `&search=${encodeURIComponent(q)}` : ""}`);
  const rows = (list.data?.rows ?? []).filter((r) => tab !== "harmful" || ["ABUSE", "HARASSMENT", "HATE_SPEECH", "SPAM", "SCAM", "SUSPICIOUS_LINK", "REPEATED_PROMO", "PII_EXPOSURE", "HIGH_RISK"].includes(r.classifications[0]?.category));
  const s = stats.data;

  return (
    <div className="space-y-6">
      <PageHeader title="AI Moderation" description="Every comment is classified with reasoning, confidence and risk. Review decisions, hide or unhide, and watch accuracy over time." actions={<>
        <Select value={pageId} onChange={(e) => { setPageId(e.target.value); setPage(1); }} className="w-52"><option value="">All Pages</option>{pages.data?.pages.filter((p) => p.status !== "DISCONNECTED").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        {can("moderation.approve") ? <Link href={`${base}/moderation/review`}><Button>Review queue{s?.awaitingReview ? ` (${s.awaitingReview})` : ""}</Button></Link> : null}
      </>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Analysed (30d)" value={s?.total ?? "—"} icon={<ShieldCheck className="h-5 w-5" />} tone="primary" />
        <Stat label="Legitimate complaints" value={s?.complaints ?? "—"} sub="Never hidden automatically" icon={<AlertTriangle className="h-5 w-5" />} tone="warning" />
        <Stat label="Spam & harmful" value={s ? s.spam + s.harmful : "—"} sub={s ? `${s.spam} spam · ${s.harmful} harmful` : undefined} icon={<EyeOff className="h-5 w-5" />} tone="danger" />
        <Stat label="Auto-hidden" value={s?.autoHidden ?? "—"} sub={s ? `FP rate ${pct(s.falsePositiveRate, 1)}` : undefined} icon={<Undo2 className="h-5 w-5" />} />
        <Stat label="Manual overrides" value={s?.manualOverrides ?? "—"} sub="Rejected AI decisions" icon={<ThumbsUp className="h-5 w-5" />} tone="success" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardHeader title="Daily moderation" />{stats.loading ? <LoadingBlock rows={3} /> : s?.daily.length ? <Sparkline series={[{ name: "Comments", color: "var(--primary)", values: s.daily.map((d) => d.total) }, { name: "Harmful", color: "var(--warning)", values: s.daily.map((d) => d.harmful) }, { name: "Hidden", color: "var(--danger)", values: s.daily.map((d) => d.hidden) }]} labels={s.daily.map((d) => d.day.slice(5))} /> : <EmptyState title="No activity yet" className="py-8" />}</Card>
        <Card><CardHeader title="Categories" />{s ? <Donut parts={[{ label: "Positive", value: s.positive, color: "var(--success)" }, { label: "Inquiries", value: (s.categories.INQUIRY ?? 0) + (s.categories.SALES_INQUIRY ?? 0), color: "var(--primary)" }, { label: "Negative", value: s.negative, color: "var(--warning)" }, { label: "Spam/harmful", value: s.spam + s.harmful, color: "var(--danger)" }, { label: "Other", value: Math.max(0, s.total - s.positive - (s.categories.INQUIRY ?? 0) - (s.categories.SALES_INQUIRY ?? 0) - s.negative - s.spam - s.harmful), color: "var(--border-strong)" }]} /> : <LoadingBlock rows={2} />}</Card>
      </div>
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <Tabs value={tab} onChange={(v) => { setTab(v); setPage(1); }} items={[{ value: "all", label: "All" }, { value: "review", label: "Needs review", count: s?.awaitingReview }, { value: "harmful", label: "Harmful" }, { value: "hidden", label: "Hidden" }]} />
          <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="w-44"><option value="">All categories</option>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search comment or author…" className="ml-auto w-full sm:w-64" />
        </div>
        {list.loading && !list.data ? <div className="p-4"><LoadingBlock /></div> : !rows.length ? <EmptyState title="No comments match" className="m-4" /> : (
          <Table className="rounded-none border-0 shadow-none">
            <thead><tr><Th>Comment</Th><Th>Category</Th><Th>Confidence</Th><Th>Decision</Th><Th>Page</Th><Th>Status</Th><Th>When</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2/60">
                  <Td className="max-w-md"><Link href={`${base}/moderation/${r.id}`} className="line-clamp-2 font-bengali text-text hover:text-primary">{r.message || <span className="text-text-3">(no text)</span>}</Link><div className="mt-0.5 text-[12px] text-text-3">{r.authorName ?? "Unknown"}{r.classifications[0] ? ` · ${r.classifications[0].language}` : ""}</div></Td>
                  <Td><CategoryBadge category={r.classifications[0]?.category} /></Td>
                  <Td><Confidence value={r.classifications[0]?.confidence} /></Td>
                  <Td><DecisionBadge decision={r.decisions[0]?.decision} autoExecuted={r.decisions[0]?.autoExecuted} reviewStatus={r.decisions[0]?.reviewStatus} /></Td>
                  <Td className="text-text-2">{r.page.name}</Td>
                  <Td>{r.isHidden ? <Badge tone="danger">Hidden</Badge> : r.status === "FAILED" ? <Badge tone="warning">Failed</Badge> : r.status === "ANALYZED" ? <Badge tone="success">Visible</Badge> : <Badge>{r.status.toLowerCase()}</Badge>}</Td>
                  <Td className="whitespace-nowrap text-text-3">{timeAgo(r.createdTime)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="px-4 pb-4"><Pagination page={page} pageSize={list.data?.pageSize ?? 25} total={list.data?.total ?? 0} onPage={setPage} /></div>
      </Card>
    </div>
  );
}
