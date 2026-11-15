"use client";
import { use, useState } from "react";
import Link from "next/link";
import { EyeOff, Eye, MessageSquare, RefreshCw, UserPlus, ExternalLink } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Field, KeyValue, LoadingBlock, PageHeader, Textarea, useToast } from "@/components/ui";
import { useWorkspace } from "@/components/app/workspace-context";
import { useApi } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMicroUsd, timeAgo } from "@/lib/utils";
import { CategoryBadge, Confidence, DecisionBadge } from "@/components/app/moderation-shared";

type Detail = { id: string; message: string; authorName: string | null; authorFbId: string | null; createdTime: string; permalink: string | null; isHidden: boolean; status: string; lastError: string | null; authorCommentCount: number; page: { id: string; name: string; status: string }; classifications: { id: string; language: string; category: string; sentiment: string; reasoning: string; confidence: number; riskScore: number; recommendedAction: string; suggestedReply: string | null; provider: string; model: string; policyVersion: string; latencyMs: number; tokensIn: number; tokensOut: number; costMicroUsd: number; createdAt: string; signals: Record<string, unknown> }[]; decisions: { id: string; decision: string; reasons: string[]; autoExecuted: boolean; reviewStatus: string; reviewNote: string | null; feedback: string | null; correctedCategory: string | null; createdAt: string }[]; actions: { id: string; type: string; actorType: string; status: string; note: string | null; createdAt: string; outboundActionId: string | null }[]; outbound: { id: string; status: string; attempts: number; lastError: string | null; externalId: string | null; completedAt: string | null }[] };

export default function CommentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { workspace, can } = useWorkspace();
  const toast = useToast();
  const d = useApi<Detail>(`/api/v1/comments/${id}`);
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = d.data?.classifications[0];
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      setTimeout(() => d.refresh(), 800);
    } catch (err) {
      toast.error("Action failed", err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };
  if (d.loading && !d.data) return <LoadingBlock rows={5} />;
  if (!d.data) return <Alert tone="danger">{d.error ?? "Not found"}</Alert>;
  const x = d.data;
  return (
    <div className="space-y-6">
      <PageHeader crumbs={["AI Moderation", x.page.name]} title="Comment detail" description={`${x.authorName ?? "Unknown author"} · ${formatDate(x.createdTime, true)} · ${x.authorCommentCount} comments on this Page`} actions={<>
        {x.permalink ? <a href={x.permalink} target="_blank" rel="noreferrer"><Button variant="outline"><ExternalLink className="h-4 w-4" /> Open on Facebook</Button></a> : null}
        {can("moderation.approve") ? <Button variant="outline" disabled={busy} onClick={() => act(() => api.post(`/api/v1/comments/${id}/analyze`), "Re-analysis queued")}><RefreshCw className="h-4 w-4" /> Re-analyse</Button> : null}
        {can("crm.access") ? <Button variant="outline" disabled={busy} onClick={() => act(() => api.post("/api/v1/leads/from-source", { commentId: id }), "Lead created")}><UserPlus className="h-4 w-4" /> Create lead</Button> : null}
        {x.isHidden ? (can("comments.unhide") ? <Button disabled={busy} onClick={() => act(() => api.post(`/api/v1/comments/${id}/unhide`, {}), "Unhide requested")}><Eye className="h-4 w-4" /> Unhide</Button> : null) : (can("comments.hide") ? <Button variant="danger" disabled={busy} onClick={() => act(() => api.post(`/api/v1/comments/${id}/hide`, {}), "Hide requested")}><EyeOff className="h-4 w-4" /> Hide</Button> : null)}
        {can("comments.reply") ? <Button disabled={busy} onClick={() => setReply(c?.suggestedReply ?? "")}><MessageSquare className="h-4 w-4" /> Reply</Button> : null}
      </>} />
      {x.page.status !== "CONNECTED" ? <Alert tone="warning">This Page is {x.page.status.toLowerCase().replace("_", " ")} — actions are disabled until it is reconnected.</Alert> : null}
      {x.status === "FAILED" ? <Alert tone="danger" title="Analysis failed">{x.lastError}</Alert> : null}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <div className="flex flex-wrap items-center gap-2"><CategoryBadge category={c?.category} /><Confidence value={c?.confidence} />{c ? <Badge tone="outline">{c.sentiment}</Badge> : null}{c ? <Badge tone="outline">{c.language}</Badge> : null}{x.isHidden ? <Badge tone="danger">Hidden on Facebook</Badge> : <Badge tone="success">Visible</Badge>}</div>
            <p className="mt-4 whitespace-pre-wrap font-bengali text-[16px] leading-relaxed text-text">{x.message}</p>
            {c ? <div className="mt-4 rounded-sm bg-surface-2 p-4 text-sm text-text-2"><div className="font-medium text-text">AI reasoning</div><p className="mt-1">{c.reasoning}</p><div className="mt-2 text-[12px] text-text-3">Recommended: {c.recommendedAction} · risk {Math.round(c.riskScore * 100)}% · {c.provider}/{c.model} · policy {c.policyVersion} · {c.latencyMs}ms · {c.tokensIn + c.tokensOut} tokens · {formatMicroUsd(c.costMicroUsd)}</div></div> : null}
            {c?.suggestedReply ? <div className="mt-3 rounded-sm border border-primary/30 bg-primary-soft/40 p-4 text-sm"><div className="font-medium text-primary">Suggested reply</div><p className="mt-1 font-bengali text-text">{c.suggestedReply}</p></div> : null}
          </Card>
          <Card>
            <CardHeader title="Decision & action history" />
            <ul className="space-y-3 text-sm">
              {x.decisions.map((dec) => (
                <li key={dec.id} className="rounded-sm border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2"><DecisionBadge decision={dec.decision} autoExecuted={dec.autoExecuted} reviewStatus={dec.reviewStatus} />{dec.feedback ? <Badge tone="outline">{dec.feedback.replace("_", " ").toLowerCase()}</Badge> : null}{dec.correctedCategory ? <Badge tone="primary">→ {dec.correctedCategory}</Badge> : null}<span className="ml-auto text-[12px] text-text-3">{timeAgo(dec.createdAt)}</span></div>
                  <div className="mt-1.5 text-[12px] text-text-3">{dec.reasons.join(" · ")}</div>
                  {dec.reviewNote ? <div className="mt-1 text-[13px] text-text-2">Note: {dec.reviewNote}</div> : null}
                  {dec.reviewStatus === "PENDING" && can("moderation.approve") ? <div className="mt-2 flex gap-2"><Button size="sm" disabled={busy} onClick={() => act(() => api.post(`/api/v1/moderation/decisions/${dec.id}`, { outcome: "APPROVE" }), "Approved")}>Approve</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => api.post(`/api/v1/moderation/decisions/${dec.id}`, { outcome: "REJECT" }), "Rejected")}>Reject</Button></div> : null}
                </li>
              ))}
              {x.actions.map((a) => {
                const ob = x.outbound.find((o) => o.id === a.outboundActionId);
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-sm bg-surface-2 px-3 py-2">
                    <Badge tone={a.type === "HIDE" ? "danger" : a.type === "REPLY" ? "primary" : "neutral"}>{a.type}</Badge><span className="text-[12px] text-text-2">by {a.actorType}</span>
                    <Badge tone={ob?.status === "SUCCEEDED" ? "success" : ob?.status === "FAILED" || ob?.status === "CANCELLED" ? "danger" : "warning"}>{ob?.status ?? a.status}{ob?.attempts ? ` · ${ob.attempts} attempt${ob.attempts > 1 ? "s" : ""}` : ""}</Badge>
                    {ob?.lastError ? <span className="text-[12px] text-danger">{ob.lastError}</span> : null}{a.note ? <span className="w-full font-bengali text-[13px] text-text-2">{a.note}</span> : null}<span className="ml-auto text-[12px] text-text-3">{timeAgo(a.createdAt)}</span>
                  </li>
                );
              })}
              {!x.decisions.length && !x.actions.length ? <li className="text-text-3">No decisions yet.</li> : null}
            </ul>
          </Card>
        </div>
        <div className="space-y-5">
          <Card><CardHeader title="Signals" />{c ? <KeyValue items={Object.entries(c.signals).filter(([k]) => !["urls"].includes(k)).map(([k, v]) => ({ k: k.replace(/([A-Z])/g, " $1").toLowerCase(), v: typeof v === "boolean" ? (v ? "yes" : "no") : String(v) }))} /> : <p className="text-sm text-text-3">Not analysed.</p>}</Card>
          <Card><CardHeader title="Context" /><KeyValue items={[{ k: "Page", v: x.page.name }, { k: "Author", v: x.authorName ?? "—" }, { k: "Author history", v: `${x.authorCommentCount} comments` }, { k: "Posted", v: formatDate(x.createdTime, true) }, { k: "Status", v: x.status.toLowerCase() }]} /><Link href={`/app/${workspace.slug}/moderation`} className="mt-3 block text-[13px] font-medium text-primary">Back to moderation</Link></Card>
        </div>
      </div>
      {reply !== null ? (
        <Dialog open onClose={() => setReply(null)} title="Reply publicly" description="Sent from the Page as a comment reply." footer={<><Button variant="outline" onClick={() => setReply(null)}>Cancel</Button><Button loading={busy} onClick={() => act(async () => { await api.post(`/api/v1/comments/${id}/reply`, { message: reply }); setReply(null); }, "Reply queued")}>Send reply</Button></>}>
          <Field label="Message"><Textarea value={reply} onChange={(e) => setReply(e.target.value)} className="font-bengali min-h-[120px]" /></Field>
        </Dialog>
      ) : null}
    </div>
  );
}
