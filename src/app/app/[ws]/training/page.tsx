"use client";
import { useRef, useState } from "react";
import { BookOpen, Upload, Plus, Trash2, FileText, GraduationCap, Tags, Gauge, Scale } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, LoadingBlock, PageHeader, Pagination, SearchInput, Select, Stat, Switch, Table, Tabs, Td, Textarea, Th, useToast } from "@/components/ui";
import { useWorkspace } from "@/components/app/workspace-context";
import { useApi } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { pct, timeAgo } from "@/lib/utils";
import { CATEGORY_LABEL, CategoryBadge } from "@/components/app/moderation-shared";
import { Bars } from "@/components/app/charts";

type Stats = { documents: number; examples: number; precedents?: number; evaluated: number; reviewerAgreement: number | null; falsePositiveRate: number | null; replyApprovalRate: number | null; versions: number; latestAccuracy: number | null; perCategory: Record<string, { precision: number; recall: number }> | null; recentEvaluations: { id: string; agent: string; completedAt: string; total: number; correct: number; metrics: { accuracy?: number } }[] };
type Source = { id: string; title: string; kind: string; status: string; sizeBytes: number; error: string | null; updatedAt: string; _count: { chunks: number } };
type Example = { id: string; kind: string; text: string; language: string; category: string | null; expectedDecision: string | null; expectedReply: string | null; explanation: string; source: string; reviewerFeedback: string; updatedAt: string };
const KINDS = ["company", "services", "policy", "faq", "approved_reply", "product", "pricing", "terms", "text"];

export default function TrainingCenter() {
  const { can } = useWorkspace();
  const [tab, setTab] = useState<"overview" | "knowledge" | "examples" | "rulings">("overview");
  const stats = useApi<Stats>("/api/v1/training/stats");
  const s = stats.data;
  return (
    <div className="space-y-6">
      <PageHeader title="AI Training Center" description="Teach the AI about this business with knowledge documents and labelled examples, then evaluate before trusting automation. Corrections guide prompts and retrieval — they do not retrain the foundation model." />
      <Tabs value={tab} onChange={setTab} items={[{ value: "overview", label: "Dashboard" }, { value: "knowledge", label: "Knowledge", count: s?.documents }, { value: "examples", label: "Training examples", count: s?.examples }, { value: "rulings", label: "Learned rulings", count: s?.precedents }]} />
      {tab === "overview" ? (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Knowledge documents" value={s?.documents ?? "—"} icon={<BookOpen className="h-5 w-5" />} tone="primary" />
            <Stat label="Training examples" value={s?.examples ?? "—"} sub={s ? `${s.evaluated} with reviewer feedback` : undefined} icon={<Tags className="h-5 w-5" />} />
            <Stat label="AI ↔ reviewer agreement (30d)" value={pct(s?.reviewerAgreement, 0)} sub={s ? `False-positive rate ${pct(s.falsePositiveRate, 1)}` : undefined} icon={<GraduationCap className="h-5 w-5" />} tone="success" />
            <Stat label="Reply approval rate" value={pct(s?.replyApprovalRate, 0)} sub={s ? `${s.versions} agent versions` : undefined} icon={<Gauge className="h-5 w-5" />} tone="warning" />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card><CardHeader title="Latest evaluation — precision by category" description={s?.latestAccuracy !== null && s?.latestAccuracy !== undefined ? `Overall accuracy ${pct(s.latestAccuracy, 1)}` : "Run an evaluation from an agent's page."} />{s?.perCategory ? <Bars data={Object.entries(s.perCategory).map(([k, v]) => ({ label: CATEGORY_LABEL[k] ?? k, value: Math.round(v.precision * 100) }))} format={(v) => `${v}%`} /> : <p className="text-sm text-text-3">No completed evaluations yet.</p>}</Card>
            <Card><CardHeader title="Recent improvements" />{s?.recentEvaluations.length ? <ul className="divide-y divide-border text-sm">{s.recentEvaluations.map((e) => <li key={e.id} className="flex items-center justify-between py-2.5"><span className="text-text">{e.agent}</span><span className="text-text-2">{e.correct}/{e.total} · {pct(e.metrics.accuracy, 1)}</span><span className="text-[12px] text-text-3">{timeAgo(e.completedAt)}</span></li>)}</ul> : <EmptyState title="No evaluations yet" className="py-8" />}</Card>
          </div>
        </div>
      ) : null}
      {tab === "knowledge" ? <Knowledge canEdit={can("agents.train")} onChanged={() => stats.refresh()} /> : null}
      {tab === "examples" ? <Examples canEdit={can("agents.train")} onChanged={() => stats.refresh()} /> : null}
      {tab === "rulings" ? <Rulings canEdit={can("moderation.approve")} onChanged={() => stats.refresh()} /> : null}
    </div>
  );
}

type Precedent = { id: string; pageId: string | null; pageName: string | null; text: string; category: string; decision: "HIDE" | "KEEP"; note: string; hits: number; lastHitAt: string | null; status: string; createdAt: string; createdByName: string | null };

/** Rulings learned from the review panel: "always hide / never hide comments like this". */
function Rulings({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [decision, setDecision] = useState("");
  const list = useApi<{ total: number; rows: Precedent[]; pageSize: number }>(`/api/v1/moderation/precedents?page=${page}&pageSize=30${search ? `&search=${encodeURIComponent(search)}` : ""}${decision ? `&decision=${decision}` : ""}`);
  const rows = list.data?.rows ?? [];
  async function patch(id: string, body: Record<string, unknown>, ok: string) {
    try {
      await api.patch(`/api/v1/moderation/precedents/${id}`, body);
      toast.success(ok);
      list.refresh();
      onChanged();
    } catch (err) {
      toast.error("Could not update ruling", err instanceof ApiError ? err.message : undefined);
    }
  }
  async function remove(id: string) {
    try {
      await api.delete(`/api/v1/moderation/precedents/${id}`);
      toast.success("Ruling removed");
      list.refresh();
      onChanged();
    } catch (err) {
      toast.error("Could not remove ruling", err instanceof ApiError ? err.message : undefined);
    }
  }
  return (
    <div className="space-y-4">
      <Alert tone="info" title="How learned rulings work">
        When a reviewer ticks <b>“always hide / never hide comments like this”</b> in the review queue, the ruling is stored here. Every new comment is compared with these rulings: identical text is handled instantly without an AI call, and the AI treats the rulings as binding when a new comment carries the same meaning in different words, language or script. Disable or remove a ruling at any time. <span className="font-bengali">(রিভিউ প্যানেলে একবার “সবসময় হাইড” বললে AI পরবর্তী সব সময় একই রকম কমেন্ট নিজে হাইড করবে।)</span>
      </Alert>
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search rulings…" className="w-72" />
        <Select value={decision} onChange={(e) => { setDecision(e.target.value); setPage(1); }} className="w-44"><option value="">All rulings</option><option value="HIDE">Always hide</option><option value="KEEP">Never hide</option></Select>
        <span className="ml-auto text-[13px] text-text-3">{list.data?.total ?? 0} rulings</span>
      </div>
      {list.loading && !list.data ? <LoadingBlock rows={4} /> : !rows.length ? <EmptyState icon={<Scale className="h-6 w-6" />} title="No rulings yet" description="Review a comment in the queue and tick “always hide / never hide comments like this” to teach the AI a standing rule." /> : (
        <Card padded={false}>
          <Table>
            <thead><tr><Th>Comment</Th><Th>Ruling</Th><Th>Scope</Th><Th>Matched</Th><Th>Active</Th><Th></Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.status === "DISABLED" ? "opacity-60" : ""}>
                  <Td><div className="max-w-md"><p className="font-bengali text-[14px] leading-snug text-text">{r.text}</p><div className="mt-1 text-[12px] text-text-3"><CategoryBadge category={r.category} /> {r.note ? <span className="ml-1">· {r.note}</span> : null}<span className="ml-1">· {r.createdByName ?? "reviewer"} · {timeAgo(r.createdAt)}</span></div></div></Td>
                  <Td><Badge tone={r.decision === "HIDE" ? "danger" : "success"}>{r.decision === "HIDE" ? "Always hide" : "Never hide"}</Badge></Td>
                  <Td>{r.pageId ? <span className="text-[13px]">{r.pageName ?? "This Page"}</span> : <Badge tone="primary">All Pages</Badge>}</Td>
                  <Td><span className="text-[13px]">{r.hits}×</span>{r.lastHitAt ? <div className="text-[11px] text-text-3">{timeAgo(r.lastHitAt)}</div> : null}</Td>
                  <Td>{canEdit ? <Switch checked={r.status === "ACTIVE"} onChange={(v) => patch(r.id, { status: v ? "ACTIVE" : "DISABLED" }, v ? "Ruling enabled" : "Ruling disabled")} /> : <Badge tone={r.status === "ACTIVE" ? "success" : "neutral"}>{r.status.toLowerCase()}</Badge>}</Td>
                  <Td className="text-right">{canEdit ? <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => patch(r.id, { decision: r.decision === "HIDE" ? "KEEP" : "HIDE" }, "Ruling flipped")}>{r.decision === "HIDE" ? "Make “never hide”" : "Make “always hide”"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => patch(r.id, { scope: r.pageId ? "WORKSPACE" : "PAGE" }, "Scope changed")}>{r.pageId ? "Apply to all Pages" : "Limit to its Page"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4 text-danger" /></Button>
                  </div> : null}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="border-t border-border px-4"><Pagination page={page} pageSize={list.data?.pageSize ?? 30} total={list.data?.total ?? 0} onPage={setPage} /></div>
        </Card>
      )}
    </div>
  );
}

function Knowledge({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const toast = useToast();
  const list = useApi<{ sources: Source[] }>("/api/v1/training/knowledge");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", kind: "faq", content: "" });
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  async function addText() {
    setSaving(true);
    try {
      await api.post("/api/v1/training/knowledge", form);
      toast.success("Knowledge added");
      setAdding(false);
      setForm({ title: "", kind: "faq", content: "" });
      list.refresh();
      onChanged();
    } catch (err) {
      toast.error("Could not add", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }
  async function upload(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("title", file.name);
    try {
      const res = await fetch("/api/v1/training/upload", { method: "POST", body: fd, headers: { "x-workspace-id": document.cookie.match(/pm_ws=([^;]+)/)?.[1] ?? "" } });
      if (!res.ok) throw new Error(((await res.json()) as { error: { message: string } }).error.message);
      toast.success("File uploaded", "It will be indexed in the background.");
      setTimeout(() => list.refresh(), 2500);
      onChanged();
    } catch (err) {
      toast.error("Upload failed", err instanceof Error ? err.message : undefined);
    }
  }
  async function remove(id: string) {
    if (!confirm("Delete this knowledge source?")) return;
    await api.delete(`/api/v1/training/knowledge/${id}`);
    list.refresh();
    onChanged();
  }
  return (
    <div className="space-y-4">
      {canEdit ? <div className="flex flex-wrap gap-2"><Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add text knowledge</Button><Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Upload PDF / TXT / CSV</Button><input ref={fileRef} type="file" accept=".pdf,.txt,.md,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></div> : null}
      {list.loading ? <LoadingBlock /> : !list.data?.sources.length ? <EmptyState icon={<FileText className="h-6 w-6" />} title="No knowledge yet" description="Add company information, services, pricing, policies, FAQs and approved replies. The AI uses only this knowledge for facts in replies." /> : (
        <Table>
          <thead><tr><Th>Title</Th><Th>Kind</Th><Th>Status</Th><Th>Chunks</Th><Th>Size</Th><Th>Updated</Th><Th></Th></tr></thead>
          <tbody>{list.data.sources.map((s) => <tr key={s.id}><Td className="font-medium">{s.title}{s.error ? <div className="text-[12px] text-danger">{s.error}</div> : null}</Td><Td><Badge tone="outline">{s.kind}</Badge></Td><Td><Badge tone={s.status === "READY" ? "success" : s.status === "FAILED" ? "danger" : "warning"}>{s.status.toLowerCase()}</Badge></Td><Td>{s._count.chunks}</Td><Td className="text-text-2">{(s.sizeBytes / 1024).toFixed(1)} KB</Td><Td className="text-text-3">{timeAgo(s.updatedAt)}</Td><Td>{canEdit ? <button onClick={() => remove(s.id)} className="text-text-3 hover:text-danger" aria-label="Delete"><Trash2 className="h-4 w-4" /></button> : null}</Td></tr>)}</tbody>
        </Table>
      )}
      <Dialog open={adding} onClose={() => setAdding(false)} title="Add knowledge" description="Plain text works best: one topic per entry, in the language your customers use." size="lg" footer={<><Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button><Button onClick={addText} loading={saving} disabled={form.title.length < 2 || form.content.length < 5}>Save</Button></>}>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Title" required><Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Saudi Arabia Al Mawarid visa — salary & terms" /></Field><Field label="Kind"><Select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>{KINDS.map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}</Select></Field></div>
          <Field label="Content" required><Textarea value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} className="font-bengali min-h-[220px]" placeholder="সৌদি আরব আল মাওয়ারিদ ইনডোর ওয়ার্কার ভিসা: বেতন ১২০০ রিয়াল, চুক্তি ২ বছর..." /></Field>
        </div>
      </Dialog>
    </div>
  );
}

function Examples({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState("");
  const [adding, setAdding] = useState(false);
  const [bulk, setBulk] = useState(false);
  const list = useApi<{ total: number; rows: Example[]; pageSize: number }>(`/api/v1/training/examples?page=${page}${kind ? `&kind=${kind}` : ""}`);
  const [form, setForm] = useState({ kind: "MODERATION", text: "", language: "bn", category: "INQUIRY", expectedDecision: "REPLY", expectedReply: "", explanation: "" });
  const [bulkText, setBulkText] = useState("");
  const [saving, setSaving] = useState(false);
  async function add() {
    setSaving(true);
    try {
      await api.post("/api/v1/training/examples", { examples: [{ ...form, expectedReply: form.expectedReply || undefined }] });
      toast.success("Example saved");
      setAdding(false);
      list.refresh();
      onChanged();
    } catch (err) {
      toast.error("Could not save", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }
  async function importBulk() {
    const rows = bulkText.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const [text, category, decision, explanation] = l.split("\t").length > 1 ? l.split("\t") : l.split("|");
      return { kind: "MODERATION", text: text?.trim(), language: "bn", category: category?.trim().toUpperCase(), expectedDecision: decision?.trim().toUpperCase() || undefined, explanation: explanation?.trim() ?? "" };
    }).filter((r) => r.text && r.category && CATEGORY_LABEL[r.category]);
    if (!rows.length) return toast.error("No valid rows", "Format: text | CATEGORY | DECISION | explanation");
    setSaving(true);
    try {
      const r = await api.post<{ created: number }>("/api/v1/training/examples", { examples: rows });
      toast.success(`${r.created} examples imported`);
      setBulk(false);
      setBulkText("");
      list.refresh();
      onChanged();
    } catch (err) {
      toast.error("Import failed", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }
  async function remove(id: string) {
    await api.delete(`/api/v1/training/examples/${id}`);
    list.refresh();
    onChanged();
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} className="w-44"><option value="">All kinds</option><option value="MODERATION">Moderation</option><option value="REPLY">Reply</option></Select>
        {canEdit ? <div className="ml-auto flex gap-2"><Button variant="outline" onClick={() => setBulk(true)}><Upload className="h-4 w-4" /> Bulk import</Button><Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add example</Button></div> : null}
      </div>
      <Alert tone="info">Examples from reviewer corrections in the moderation queue appear here automatically (source: feedback). They are included in the classifier prompt and used for evaluations.</Alert>
      {list.loading && !list.data ? <LoadingBlock /> : !list.data?.rows.length ? <EmptyState title="No examples yet" description="Add representative Bengali, Banglish and English comments with the correct category and decision." /> : (
        <>
          <Table>
            <thead><tr><Th>Text</Th><Th>Category</Th><Th>Decision</Th><Th>Source</Th><Th>Explanation</Th><Th></Th></tr></thead>
            <tbody>{list.data.rows.map((e) => <tr key={e.id}><Td className="max-w-md"><span className="line-clamp-2 font-bengali">{e.text}</span>{e.expectedReply ? <div className="mt-0.5 line-clamp-1 text-[12px] text-primary">→ {e.expectedReply}</div> : null}</Td><Td><CategoryBadge category={e.category} /></Td><Td>{e.expectedDecision ? <Badge tone={e.expectedDecision === "HIDE" ? "danger" : e.expectedDecision === "REPLY" ? "primary" : "neutral"}>{e.expectedDecision}</Badge> : "—"}</Td><Td><Badge tone="outline">{e.source.toLowerCase()}</Badge></Td><Td className="max-w-xs text-[13px] text-text-2"><span className="line-clamp-2">{e.explanation || "—"}</span></Td><Td>{canEdit ? <button onClick={() => remove(e.id)} className="text-text-3 hover:text-danger" aria-label="Delete"><Trash2 className="h-4 w-4" /></button> : null}</Td></tr>)}</tbody>
          </Table>
          <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </>
      )}
      <Dialog open={adding} onClose={() => setAdding(false)} title="Add training example" size="lg" footer={<><Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button><Button onClick={add} loading={saving} disabled={!form.text}>Save example</Button></>}>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3"><Field label="Kind"><Select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}><option value="MODERATION">Moderation</option><option value="REPLY">Reply</option></Select></Field><Field label="Language"><Select value={form.language} onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}><option value="bn">বাংলা</option><option value="banglish">Banglish</option><option value="en">English</option><option value="mixed">Mixed</option></Select></Field><Field label="Category"><Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field></div>
          <Field label="Comment / message text" required><Textarea value={form.text} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))} className="font-bengali" /></Field>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Expected decision"><Select value={form.expectedDecision} onChange={(e) => setForm((f) => ({ ...f, expectedDecision: e.target.value }))}><option value="KEEP">Keep</option><option value="REPLY">Reply</option><option value="REVIEW">Review</option><option value="HIDE">Hide</option></Select></Field><Field label="Explanation"><Input value={form.explanation} onChange={(e) => setForm((f) => ({ ...f, explanation: e.target.value }))} placeholder="Why this is the right call" /></Field></div>
          {form.kind === "REPLY" ? <Field label="Approved reply"><Textarea value={form.expectedReply} onChange={(e) => setForm((f) => ({ ...f, expectedReply: e.target.value }))} className="font-bengali" /></Field> : null}
        </div>
      </Dialog>
      <Dialog open={bulk} onClose={() => setBulk(false)} title="Bulk import examples" description="One per line: text | CATEGORY | DECISION | explanation (tab-separated also works)." size="lg" footer={<><Button variant="outline" onClick={() => setBulk(false)}>Cancel</Button><Button onClick={importBulk} loading={saving}>Import</Button></>}>
        <Textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} className="font-bengali min-h-[240px]" placeholder={"আপনাদের সার্ভিস সম্পর্কে বিস্তারিত জানতে চাই। | INQUIRY | REPLY | asks for details\n100% guaranteed visa inbox me | SCAM | HIDE | fraudulent offer"} />
      </Dialog>
    </div>
  );
}
