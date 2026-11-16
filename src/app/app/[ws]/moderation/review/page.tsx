"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, X, Edit3 } from "lucide-react";
import { Alert, Button, Card, Checkbox, Dialog, EmptyState, Field, LoadingBlock, PageHeader, Pagination, Select, Textarea, useToast } from "@/components/ui";
import { useWorkspace } from "@/components/app/workspace-context";
import { useApi } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import { ALWAYS_OFF, AlwaysRuling, CATEGORY_LABEL, CategoryBadge, Confidence, DecisionBadge, PrecedentBadge, type AlwaysState } from "@/components/app/moderation-shared";

type Row = { id: string; message: string; authorName: string | null; createdTime: string; permalink: string | null; page: { name: string }; classifications: { category: string; confidence: number; riskScore: number; reasoning: string; suggestedReply: string | null; language: string; precedentId?: string | null }[]; decisions: { id: string; decision: string; reasons: string[]; reviewStatus: string }[] };

export default function ReviewQueue() {
  const { workspace } = useWorkspace();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [always, setAlways] = useState<Record<string, AlwaysState>>({});
  const alwaysFor = (id: string) => always[id] ?? ALWAYS_OFF;
  const list = useApi<{ total: number; rows: Row[]; pageSize: number }>(`/api/v1/comments?review=PENDING&page=${page}&pageSize=20`);
  const rows = list.data?.rows ?? [];

  async function decide(row: Row, outcome: "APPROVE" | "REJECT", extra: Record<string, unknown> = {}) {
    try {
      const a = alwaysFor(row.id);
      const r = await api.post<{ precedentId?: string | null }>(`/api/v1/moderation/decisions/${row.decisions[0].id}`, { outcome, ...(a.always ? { always: true, alwaysScope: a.alwaysScope } : {}), ...extra });
      toast.success(outcome === "APPROVE" ? "Decision approved" : "Decision rejected", r.precedentId ? "Ruling saved — the AI will apply it to similar comments from now on." : undefined);
      list.refresh();
    } catch (err) {
      toast.error("Could not save decision", err instanceof ApiError ? err.message : undefined);
    }
  }
  async function bulk(outcome: "APPROVE" | "REJECT") {
    const ids = rows.filter((r) => selected.includes(r.id)).map((r) => r.decisions[0].id);
    const r = await api.post<{ results: { ok: boolean }[] }>("/api/v1/moderation/bulk", { decisionIds: ids, outcome });
    toast.success(`${r.results.filter((x) => x.ok).length} decisions ${outcome === "APPROVE" ? "approved" : "rejected"}`);
    setSelected([]);
    list.refresh();
  }

  return (
    <div className="space-y-6">
      <PageHeader crumbs={["AI Moderation"]} title="Comment review queue" description="Comments the AI was not sure about, or that need a human under this Page's policy. Approve to hide / send, reject to keep visible. Tick “always” and the AI applies your ruling to every similar comment from now on." actions={selected.length ? <><Button variant="outline" onClick={() => bulk("REJECT")}><X className="h-4 w-4" /> Reject {selected.length}</Button><Button onClick={() => bulk("APPROVE")}><Check className="h-4 w-4" /> Approve {selected.length}</Button></> : null} />
      {list.loading && !list.data ? <LoadingBlock rows={4} /> : !rows.length ? <EmptyState title="Queue is empty" description="New AI decisions needing a human will show up here." /> : (
        <div className="space-y-3">
          {rows.map((r) => {
            const c = r.classifications[0];
            const d = r.decisions[0];
            return (
              <Card key={r.id} className="animate-fade-up">
                <div className="flex gap-4">
                  <Checkbox checked={selected.includes(r.id)} onChange={(v) => setSelected((s) => (v ? [...s, r.id] : s.filter((x) => x !== r.id)))} className="mt-1" />
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <CategoryBadge category={c?.category} /><Confidence value={c?.confidence} /><span className="text-[12px] text-text-3">risk {Math.round((c?.riskScore ?? 0) * 100)}%</span><PrecedentBadge precedentId={c?.precedentId} />
                      <DecisionBadge decision={d.decision} reviewStatus={d.reviewStatus} />
                      <span className="ml-auto text-[12px] text-text-3">{r.page.name} · {r.authorName ?? "Unknown"} · {timeAgo(r.createdTime)}</span>
                    </div>
                    <p className="font-bengali text-[15px] leading-relaxed text-text">{r.message}</p>
                    <div className="rounded-sm bg-surface-2 px-3.5 py-2.5 text-[13px] text-text-2"><span className="font-medium text-text">Why:</span> {c?.reasoning}{d.reasons.length ? <span className="block text-[12px] text-text-3">Policy: {d.reasons.join(" · ")}</span> : null}</div>
                    {c?.suggestedReply ? <div className="rounded-sm border border-primary/30 bg-primary-soft/40 px-3.5 py-2.5 text-[13px]"><span className="font-medium text-primary">Suggested reply:</span> <span className="font-bengali text-text">{c.suggestedReply}</span></div> : null}
                    {d.decision !== "REPLY" ? <AlwaysRuling compact value={alwaysFor(r.id)} onChange={(v) => setAlways((s) => ({ ...s, [r.id]: v }))} decision="BOTH" /> : null}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => decide(r, "APPROVE")}><Check className="h-4 w-4" /> {d.decision === "HIDE" ? "Approve hide" : d.decision === "REPLY" ? "Approve & send reply" : "Hide comment"}</Button>
                      <Button size="sm" variant="outline" onClick={() => decide(r, "REJECT")}><X className="h-4 w-4" /> Reject (keep visible)</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)}><Edit3 className="h-4 w-4" /> Correct / edit reply</Button>
                      <Link href={`/app/${workspace.slug}/moderation/${r.id}`} className="ml-auto self-center text-[13px] font-medium text-primary">Details</Link>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
          <Pagination page={page} pageSize={list.data?.pageSize ?? 20} total={list.data?.total ?? 0} onPage={setPage} />
        </div>
      )}
      {editing ? <CorrectDialog row={editing} onClose={() => setEditing(null)} onSubmit={async (payload) => { await decide(editing, payload.outcome, payload); setEditing(null); }} /> : null}
    </div>
  );
}

function CorrectDialog({ row, onClose, onSubmit }: { row: Row; onClose: () => void; onSubmit: (p: { outcome: "APPROVE" | "REJECT"; feedback?: string; correctedCategory?: string; editedReply?: string; note?: string; saveAsExample: boolean }) => Promise<void> }) {
  const c = row.classifications[0];
  const [category, setCategory] = useState(c?.category ?? "");
  const [reply, setReply] = useState(c?.suggestedReply ?? "");
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState(c ? "WRONG_CATEGORY" : "CORRECT");
  const [loading, setLoading] = useState(false);
  const changedCategory = category !== c?.category;
  return (
    <Dialog open onClose={onClose} title="Correct the AI" description="Corrections are saved as training examples and improve future evaluations." footer={<>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button variant="outline" loading={loading} onClick={async () => { setLoading(true); await onSubmit({ outcome: "REJECT", feedback, correctedCategory: changedCategory ? category : undefined, note, saveAsExample: true }); }}>Reject & save</Button>
      <Button loading={loading} onClick={async () => { setLoading(true); await onSubmit({ outcome: "APPROVE", feedback: changedCategory ? "WRONG_CATEGORY" : "CORRECT", correctedCategory: changedCategory ? category : undefined, editedReply: reply && reply !== c?.suggestedReply ? reply : undefined, note, saveAsExample: true }); }}>Approve with changes</Button>
    </>}>
      <div className="space-y-4">
        <p className="rounded-sm bg-surface-2 p-3 font-bengali text-sm text-text">{row.message}</p>
        <Field label="Correct category"><Select value={category} onChange={(e) => setCategory(e.target.value)}>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Feedback"><Select value={feedback} onChange={(e) => setFeedback(e.target.value)}><option value="CORRECT">AI was correct</option><option value="FALSE_POSITIVE">False positive (should not be flagged)</option><option value="FALSE_NEGATIVE">False negative (should have been flagged)</option><option value="WRONG_CATEGORY">Wrong category</option></Select></Field>
        <Field label="Reply to send (optional)" hint="Approving with a reply sends it publicly from the Page."><Textarea value={reply} onChange={(e) => setReply(e.target.value)} className="font-bengali" /></Field>
        <Field label="Reviewer note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[64px]" /></Field>
        {!c ? <Alert tone="warning">This comment was not analysed yet.</Alert> : null}
      </div>
    </Dialog>
  );
}
