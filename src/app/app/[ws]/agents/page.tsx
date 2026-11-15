"use client";
import { useState } from "react";
import Link from "next/link";
import { Bot, Plus, Sparkles } from "lucide-react";
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, LoadingBlock, PageHeader, Select, Textarea, useToast } from "@/components/ui";
import { useWorkspace } from "@/components/app/workspace-context";
import { useApi } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/utils";

type Agent = { id: string; name: string; description: string; purpose: string; status: string; updatedAt: string; versions: { version: number; provider: string; model: string }[]; _count: { versions: number; evaluations: number } };
type Templates = { templates: Record<string, { name: string; description: string; instructions: string; tone: string }>; providers: Record<string, string[]> };
export const PURPOSES: Record<string, string> = { MODERATION: "Comment moderation", PUBLIC_REPLY: "Public reply", SUPPORT: "Customer support", SALES: "Sales inquiry", LEAD_QUALIFICATION: "Lead qualification", COMPLAINT: "Complaint handling", MESSENGER: "Messenger support" };

export default function AgentStudio() {
  const { workspace, can } = useWorkspace();
  const base = `/app/${workspace.slug}`;
  const list = useApi<{ agents: Agent[] }>("/api/v1/agents");
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-6">
      <PageHeader title="AI Agent Studio" description="Create purpose-built agents with their own instructions, tone, provider, model, safety rules and knowledge. Every change is a new version you can test before activating." actions={can("agents.configure") ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New agent</Button> : null} />
      {list.loading ? <LoadingBlock rows={3} /> : !list.data?.agents.length ? (
        <EmptyState icon={<Bot className="h-6 w-6" />} title="No agents yet" description="Start from a template — a moderation agent and a public reply agent are the usual first two." action={can("agents.configure") ? <Button onClick={() => setCreating(true)}><Sparkles className="h-4 w-4" /> Create from template</Button> : undefined} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.data.agents.map((a) => (
            <Link key={a.id} href={`${base}/agents/${a.id}`} className="group rounded-card border border-border bg-surface p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-card">
              <div className="flex items-start justify-between gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-primary-soft text-primary"><Bot className="h-5 w-5" /></div>
                <Badge tone={a.status === "ACTIVE" ? "success" : a.status === "ARCHIVED" ? "neutral" : "warning"}>{a.status.toLowerCase()}</Badge>
              </div>
              <h3 className="mt-3 text-[15px] font-semibold text-text group-hover:text-primary">{a.name}</h3>
              <div className="text-[12px] text-text-3">{PURPOSES[a.purpose]}</div>
              <p className="mt-2 line-clamp-2 text-[13px] text-text-2">{a.description || "No description"}</p>
              <div className="mt-4 flex items-center justify-between text-[12px] text-text-3"><span>{a.versions[0] ? `${a.versions[0].provider} · ${a.versions[0].model}` : "—"}</span><span>v{a.versions[0]?.version ?? 0} · {a._count.evaluations} evals · {timeAgo(a.updatedAt)}</span></div>
            </Link>
          ))}
        </div>
      )}
      {creating ? <CreateAgentDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); list.refresh(); }} /> : null}
    </div>
  );
}

function CreateAgentDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const tpl = useApi<Templates>("/api/v1/agents/templates");
  const knowledge = useApi<{ sources: { id: string; title: string; status: string }[] }>("/api/v1/training/knowledge");
  const [purpose, setPurpose] = useState("MODERATION");
  const [form, setForm] = useState({ name: "", description: "", instructions: "", tone: "professional", provider: "openai", model: "gpt-4.1-mini", temperature: 0.2, safetyRules: "", escalationRules: "", responseConstraints: "", languages: ["bn", "en"] as string[], knowledgeSourceIds: [] as string[] });
  const [saving, setSaving] = useState(false);
  const applyTemplate = (p: string) => {
    setPurpose(p);
    const t = tpl.data?.templates[p];
    if (t) setForm((f) => ({ ...f, name: t.name, description: t.description, instructions: t.instructions, tone: t.tone }));
  };
  async function create(activate: boolean) {
    setSaving(true);
    try {
      await api.post("/api/v1/agents", { name: form.name, description: form.description, purpose, activate, version: { instructions: form.instructions, languages: form.languages, tone: form.tone, provider: form.provider, model: form.model, temperature: form.temperature, safetyRules: form.safetyRules, escalationRules: form.escalationRules, responseConstraints: form.responseConstraints, knowledgeSourceIds: form.knowledgeSourceIds, changeNote: "Initial version" } });
      toast.success("Agent created");
      onCreated();
    } catch (err) {
      toast.error("Could not create agent", err instanceof ApiError ? err.message : undefined);
      setSaving(false);
    }
  }
  const models = tpl.data?.providers[form.provider] ?? [];
  return (
    <Dialog open onClose={onClose} title="New AI agent" description="Pick a purpose to start from a template, then adjust." size="xl" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="outline" loading={saving} onClick={() => create(false)} disabled={!form.name || form.instructions.length < 10}>Save as draft</Button><Button loading={saving} onClick={() => create(true)} disabled={!form.name || form.instructions.length < 10}>Create & activate</Button></>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <Field label="Purpose"><Select value={purpose} onChange={(e) => applyTemplate(e.target.value)}>{Object.entries(PURPOSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Name" required><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={tpl.data?.templates[purpose]?.name} /></Field>
          <Field label="Description"><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider"><Select value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value, model: tpl.data?.providers[e.target.value]?.[0] ?? "" }))}><option value="openai">OpenAI</option><option value="gemini">Google Gemini</option><option value="deepseek">DeepSeek</option></Select></Field>
            <Field label="Model"><Select value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}>{models.map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Temperature" hint="0 = consistent, 1 = creative"><Input type="number" min={0} max={1.5} step={0.05} value={form.temperature} onChange={(e) => setForm((f) => ({ ...f, temperature: Number(e.target.value) }))} /></Field>
            <Field label="Tone"><Input value={form.tone} onChange={(e) => setForm((f) => ({ ...f, tone: e.target.value }))} /></Field>
          </div>
          <Field label="Languages"><div className="flex gap-4 text-sm">{[["bn", "বাংলা"], ["banglish", "Banglish"], ["en", "English"]].map(([k, l]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={form.languages.includes(k)} onChange={(e) => setForm((f) => ({ ...f, languages: e.target.checked ? [...f.languages, k] : f.languages.filter((x) => x !== k) }))} />{l}</label>)}</div></Field>
        </div>
        <div className="space-y-4">
          <Field label="Instructions" required hint="How the agent should think and behave for this business."><Textarea value={form.instructions} onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))} className="min-h-[140px]" /></Field>
          <Field label="Safety rules"><Textarea value={form.safetyRules} onChange={(e) => setForm((f) => ({ ...f, safetyRules: e.target.value }))} className="min-h-[64px]" placeholder="e.g. Never promise visa approval or quote salaries not in the knowledge base." /></Field>
          <Field label="Escalation rules"><Textarea value={form.escalationRules} onChange={(e) => setForm((f) => ({ ...f, escalationRules: e.target.value }))} className="min-h-[64px]" placeholder="e.g. Escalate refund requests and legal threats to a human." /></Field>
          <Field label="Knowledge sources" hint="Leave empty to use all workspace knowledge."><div className="max-h-28 space-y-1 overflow-y-auto rounded-sm border border-border p-2 text-sm scrollbar-thin">{knowledge.data?.sources.filter((s) => s.status === "READY").map((s) => <label key={s.id} className="flex items-center gap-2"><input type="checkbox" checked={form.knowledgeSourceIds.includes(s.id)} onChange={(e) => setForm((f) => ({ ...f, knowledgeSourceIds: e.target.checked ? [...f.knowledgeSourceIds, s.id] : f.knowledgeSourceIds.filter((x) => x !== s.id) }))} />{s.title}</label>) ?? <span className="text-text-3">No knowledge yet</span>}</div></Field>
        </div>
      </div>
    </Dialog>
  );
}
