"use client";
import { use, useState } from "react";
import { Play, History, FlaskConical, Power, Archive } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, KeyValue, LoadingBlock, PageHeader, Select, Tabs, Textarea, useToast } from "@/components/ui";
import { useWorkspace } from "@/components/app/workspace-context";
import { useApi } from "@/lib/hooks";
import { BrainKeySelect, PROVIDER_IDS, PROVIDER_LABEL } from "@/components/app/brain-key-select";
import { api, ApiError } from "@/lib/api";
import { formatDate, pct, timeAgo } from "@/lib/utils";
import { PURPOSES } from "../page";
import { CategoryBadge, Confidence } from "@/components/app/moderation-shared";

type Version = { id: string; version: number; instructions: string; languages: string[]; tone: string; provider: string; model: string; credentialId?: string | null; temperature: number; safetyRules: string; escalationRules: string; responseConstraints: string; knowledgeSourceIds: string[]; changeNote: string; createdAt: string };
type Detail = { agent: { id: string; name: string; description: string; purpose: string; status: string; activeVersionId: string | null; versions: Version[]; evaluations: { id: string; status: string; total: number; correct: number; metrics: { accuracy?: number; hide?: { falsePositiveRate: number }; complaintPreserved?: number }; createdAt: string; completedAt: string | null; agentVersionId: string; error: string | null }[] }; assignedPages: { id: string; name: string }[] };

export default function AgentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useWorkspace();
  const toast = useToast();
  const d = useApi<Detail>(`/api/v1/agents/${id}`);
  const providers = useApi<{ providers: Record<string, string[]> }>("/api/v1/agents/templates");
  const knowledge = useApi<{ sources: { id: string; title: string; status: string }[] }>("/api/v1/training/knowledge");
  const [tab, setTab] = useState<"config" | "test" | "versions" | "evals">("config");
  const [busy, setBusy] = useState(false);
  if (d.loading && !d.data) return <LoadingBlock rows={5} />;
  if (!d.data) return <Alert tone="danger">{d.error}</Alert>;
  const a = d.data.agent;
  const active = a.versions.find((v) => v.id === a.activeVersionId) ?? a.versions[0];
  const patch = async (p: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      await api.patch(`/api/v1/agents/${id}`, p);
      toast.success(ok);
      d.refresh();
    } catch (err) {
      toast.error("Failed", err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader crumbs={["AI Agent Studio", PURPOSES[a.purpose]]} title={a.name} description={a.description} actions={can("agents.configure") ? <>
        {a.status !== "ACTIVE" ? <Button onClick={() => patch({ status: "ACTIVE" }, "Agent activated")} loading={busy}><Power className="h-4 w-4" /> Activate</Button> : <Button variant="outline" onClick={() => patch({ status: "DRAFT" }, "Agent deactivated")} loading={busy}><Power className="h-4 w-4" /> Deactivate</Button>}
        {a.status !== "ARCHIVED" ? <Button variant="ghost" onClick={() => patch({ status: "ARCHIVED" }, "Agent archived")} loading={busy}><Archive className="h-4 w-4" /> Archive</Button> : null}
      </> : null} />
      <div className="flex flex-wrap items-center gap-2"><Badge tone={a.status === "ACTIVE" ? "success" : "warning"}>{a.status.toLowerCase()}</Badge>{active ? <Badge tone="outline">v{active.version} active · {active.provider}/{active.model}</Badge> : null}{d.data.assignedPages.length ? <Badge tone="primary">Assigned to {d.data.assignedPages.map((p) => p.name).join(", ")}</Badge> : <Badge>Workspace default for {PURPOSES[a.purpose]}</Badge>}</div>
      <Tabs value={tab} onChange={setTab} items={[{ value: "config", label: "Configuration" }, { value: "test", label: "Playground" }, { value: "versions", label: "Versions", count: a.versions.length }, { value: "evals", label: "Evaluations", count: a.evaluations.length }]} />
      {tab === "config" && active ? <ConfigForm agentId={id} version={active} providers={providers.data?.providers ?? {}} knowledge={knowledge.data?.sources ?? []} canEdit={can("agents.configure")} onSaved={() => d.refresh()} /> : null}
      {tab === "test" ? <Playground agentId={id} purpose={a.purpose} versions={a.versions} activeVersionId={a.activeVersionId} /> : null}
      {tab === "versions" ? (
        <Card padded={false}>
          <ul className="divide-y divide-border">
            {a.versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <Badge tone={v.id === a.activeVersionId ? "success" : "neutral"}>v{v.version}{v.id === a.activeVersionId ? " · active" : ""}</Badge>
                <span className="text-text">{v.changeNote || "No note"}</span>
                <span className="text-[12px] text-text-3">{v.provider}/{v.model} · temp {v.temperature} · {formatDate(v.createdAt, true)}</span>
                {v.id !== a.activeVersionId && can("agents.configure") ? <Button size="sm" variant="outline" className="ml-auto" onClick={() => patch({ activeVersionId: v.id }, `Version ${v.version} activated`)}><History className="h-4 w-4" /> Activate this version</Button> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {tab === "evals" ? <Evaluations agentId={id} evaluations={a.evaluations} versions={a.versions} canTrain={can("agents.train")} onRefresh={() => d.refresh()} /> : null}
    </div>
  );
}

function ConfigForm({ agentId, version, providers, knowledge, canEdit, onSaved }: { agentId: string; version: Version; providers: Record<string, string[]>; knowledge: { id: string; title: string; status: string }[]; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ ...version, changeNote: "" });
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  async function save(activate: boolean) {
    setSaving(true);
    try {
      await api.post(`/api/v1/agents/${agentId}/versions`, { instructions: f.instructions, languages: f.languages, tone: f.tone, provider: f.provider, model: f.model, credentialId: f.credentialId ?? null, temperature: f.temperature, safetyRules: f.safetyRules, escalationRules: f.escalationRules, responseConstraints: f.responseConstraints, knowledgeSourceIds: f.knowledgeSourceIds, changeNote: f.changeNote || "Updated configuration", activate });
      toast.success(activate ? "New version saved and activated" : "New version saved as draft");
      onSaved();
    } catch (err) {
      toast.error("Could not save", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Card>
      <CardHeader title={`Editing from v${version.version}`} description="Saving creates a new immutable version. Activate it when you are happy with playground results." action={canEdit ? <div className="flex gap-2"><Button variant="outline" loading={saving} onClick={() => save(false)}>Save draft version</Button><Button loading={saving} onClick={() => save(true)}>Save & activate</Button></div> : null} />
      <fieldset disabled={!canEdit} className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <Field label="Instructions"><Textarea value={f.instructions} onChange={(e) => set("instructions", e.target.value)} className="min-h-[200px]" /></Field>
          <Field label="Safety rules"><Textarea value={f.safetyRules} onChange={(e) => set("safetyRules", e.target.value)} /></Field>
          <Field label="Escalation rules"><Textarea value={f.escalationRules} onChange={(e) => set("escalationRules", e.target.value)} className="min-h-[72px]" /></Field>
          <Field label="Response constraints" hint="e.g. max 3 sentences, never mention competitors"><Textarea value={f.responseConstraints} onChange={(e) => set("responseConstraints", e.target.value)} className="min-h-[64px]" /></Field>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider"><Select value={f.provider} onChange={(e) => { set("provider", e.target.value); set("model", providers[e.target.value]?.[0] ?? ""); set("credentialId", null); }}>{PROVIDER_IDS.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}</Select></Field>
            <Field label="Model"><Select value={f.model} onChange={(e) => set("model", e.target.value)}>{(providers[f.provider] ?? [f.model]).map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field>
            <div className="col-span-2"><BrainKeySelect provider={f.provider} value={f.credentialId} onChange={(v) => set("credentialId", v)} /></div>
            <Field label="Temperature"><Input type="number" min={0} max={1.5} step={0.05} value={f.temperature} onChange={(e) => set("temperature", Number(e.target.value))} /></Field>
            <Field label="Tone"><Input value={f.tone} onChange={(e) => set("tone", e.target.value)} /></Field>
          </div>
          <Field label="Languages"><div className="flex gap-4 text-sm">{[["bn", "বাংলা"], ["banglish", "Banglish"], ["en", "English"]].map(([k, l]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={f.languages.includes(k)} onChange={(e) => set("languages", e.target.checked ? [...f.languages, k] : f.languages.filter((x) => x !== k))} />{l}</label>)}</div></Field>
          <Field label="Knowledge sources" hint="Empty = all workspace knowledge"><div className="max-h-40 space-y-1 overflow-y-auto rounded-sm border border-border p-2 text-sm scrollbar-thin">{knowledge.filter((s) => s.status === "READY").map((s) => <label key={s.id} className="flex items-center gap-2"><input type="checkbox" checked={f.knowledgeSourceIds.includes(s.id)} onChange={(e) => set("knowledgeSourceIds", e.target.checked ? [...f.knowledgeSourceIds, s.id] : f.knowledgeSourceIds.filter((x) => x !== s.id))} />{s.title}</label>)}{!knowledge.length ? <span className="text-text-3">No knowledge sources yet — add some in the Training Center.</span> : null}</div></Field>
          <Field label="Change note"><Input value={f.changeNote} onChange={(e) => set("changeNote", e.target.value)} placeholder="What changed and why" /></Field>
        </div>
      </fieldset>
    </Card>
  );
}

function Playground({ agentId, purpose, versions, activeVersionId }: { agentId: string; purpose: string; versions: Version[]; activeVersionId: string | null }) {
  const [text, setText] = useState(purpose === "MODERATION" ? "ভাই সৌদি আরবে কাজের বেতন কত?" : "Assalamu alaikum, Malaysia te factory job ache? Beton koto?");
  const [versionId, setVersionId] = useState(activeVersionId ?? versions[0]?.id ?? "");
  const [result, setResult] = useState<{ kind: string; result: Record<string, unknown>; model: string; provider: string; latencyMs: number; tokens: number; knowledgeUsed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function run() {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.post(`/api/v1/agents/${agentId}/test`, { text, versionId }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Test failed");
    } finally {
      setLoading(false);
    }
  }
  const r = result?.result as { category?: string; confidence?: number; risk_score?: number; reasoning?: string; recommended_action?: string; suggested_reply?: string | null; language?: string; reply?: string; escalate?: boolean; reason?: string } | undefined;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Try a sample" description="Runs the selected version against your knowledge. Nothing is sent to Facebook; the call is metered as a test." />
        <div className="space-y-3">
          <Field label="Version"><Select value={versionId} onChange={(e) => setVersionId(e.target.value)}>{versions.map((v) => <option key={v.id} value={v.id}>v{v.version}{v.id === activeVersionId ? " (active)" : ""} · {v.model}</option>)}</Select></Field>
          <Field label={purpose === "MODERATION" ? "Comment text" : "Customer message"}><Textarea value={text} onChange={(e) => setText(e.target.value)} className="font-bengali min-h-[120px]" /></Field>
          <Button onClick={run} loading={loading}><Play className="h-4 w-4" /> Run</Button>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
      </Card>
      <Card>
        <CardHeader title="Result" />
        {!result ? <p className="text-sm text-text-3">Run a sample to see the agent's output.</p> : result.kind === "classification" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2"><CategoryBadge category={r?.category} /><Confidence value={r?.confidence} /><Badge tone="outline">risk {Math.round((r?.risk_score ?? 0) * 100)}%</Badge><Badge tone={r?.recommended_action === "HIDE" ? "danger" : r?.recommended_action === "REPLY" ? "primary" : "warning"}>{r?.recommended_action}</Badge><Badge tone="outline">{r?.language}</Badge></div>
            <p className="text-sm text-text-2">{r?.reasoning}</p>
            {r?.suggested_reply ? <div className="rounded-sm bg-primary-soft/40 p-3 font-bengali text-sm text-text">{r.suggested_reply}</div> : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-sm bg-surface-2 p-3 font-bengali text-sm text-text">{r?.reply}</div>
            <div className="flex flex-wrap items-center gap-2"><Confidence value={r?.confidence} />{r?.escalate ? <Badge tone="warning">Escalate to human</Badge> : <Badge tone="success">No escalation</Badge>}<span className="text-[12px] text-text-3">{r?.reason}</span></div>
          </div>
        )}
        {result ? <div className="mt-4 text-[12px] text-text-3">{result.provider}/{result.model} · {result.latencyMs}ms · {result.tokens} tokens · {result.knowledgeUsed} knowledge chunks used</div> : null}
      </Card>
    </div>
  );
}

function Evaluations({ agentId, evaluations, versions, canTrain, onRefresh }: { agentId: string; evaluations: Detail["agent"]["evaluations"]; versions: Version[]; canTrain: boolean; onRefresh: () => void }) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  async function run() {
    setLoading(true);
    try {
      await api.post(`/api/v1/agents/${agentId}/evaluations`, {});
      toast.success("Evaluation queued", "The worker runs each labelled example through this agent; results appear here.");
      setTimeout(onRefresh, 1500);
    } catch (err) {
      toast.error("Could not start evaluation", err instanceof ApiError ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }
  return (
    <Card>
      <CardHeader title="Evaluations" description="Measures classification accuracy, per-category precision/recall, false-positive rate for HIDE, and how well complaints are preserved. Run one before enabling automatic hiding." action={canTrain ? <Button onClick={run} loading={loading}><FlaskConical className="h-4 w-4" /> Run evaluation</Button> : null} />
      {!evaluations.length ? <p className="text-sm text-text-3">No evaluations yet. Add at least 5 labelled examples in the Training Center first.</p> : (
        <ul className="divide-y divide-border">
          {evaluations.map((e) => {
            const v = versions.find((x) => x.id === e.agentVersionId);
            return (
              <li key={e.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone={e.status === "COMPLETED" ? "success" : e.status === "FAILED" ? "danger" : "warning"}>{e.status.toLowerCase()}</Badge><span className="text-text">v{v?.version ?? "?"}</span><span className="text-[12px] text-text-3">{timeAgo(e.createdAt)}</span>{e.error ? <span className="text-[12px] text-danger">{e.error}</span> : null}</div>
                {e.status === "COMPLETED" ? <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"><KeyValue items={[{ k: "Accuracy", v: pct(e.metrics.accuracy, 1) }]} /><KeyValue items={[{ k: "Examples", v: `${e.correct}/${e.total}` }]} /><KeyValue items={[{ k: "Hide FP rate", v: pct(e.metrics.hide?.falsePositiveRate, 1) }]} /><KeyValue items={[{ k: "Complaints preserved", v: pct(e.metrics.complaintPreserved, 0) }]} /></div> : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
