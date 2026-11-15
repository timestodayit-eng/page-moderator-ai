"use client";
import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Globe, Plug, RefreshCw, Trash2, Settings2, CheckCircle2, AlertTriangle, PauseCircle } from "lucide-react";
import { Alert, Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, Input, LoadingBlock, PageHeader, Select, Switch, useToast, Avatar } from "@/components/ui";
import { useWorkspace } from "@/components/app/workspace-context";
import { useApi } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/utils";

type Page = { id: string; fbPageId: string; name: string; category: string | null; pictureUrl: string | null; status: string; grantedScopes: string[]; missingScopes: string[]; webhookSubscribed: boolean; webhookFields: string[]; lastHealthCheckAt: string | null; healthError: string | null; connectedAt: string; moderationMode: "SHADOW" | "APPROVAL" | "AUTO"; autoHideEnabled: boolean; killSwitch: boolean; replyMode: "OFF" | "SUGGEST" | "APPROVAL" | "LIMITED_AUTO"; moderationAgentId: string | null; replyAgentId: string | null; messengerAgentId: string | null; settings: { categories: Record<string, { autoHide: boolean; threshold: number }>; maxAutoHidesPerHour: number; autoReplyCategories: string[]; maxAutoRepliesPerHour: number; replyMinConfidence: number; notifyOnIncidents: boolean }; _count: { comments: number; conversations: number } };
type Agent = { id: string; name: string; purpose: string; status: string };
const HIDE_CATS = ["SPAM", "SCAM", "SUSPICIOUS_LINK", "REPEATED_PROMO", "ABUSE", "HARASSMENT", "HATE_SPEECH", "PII_EXPOSURE", "HIGH_RISK"];
const REPLY_CATS = ["INQUIRY", "SALES_INQUIRY", "POSITIVE", "NEUTRAL", "COMPLAINT"];

function PagesScreenInner() {
  const { workspace, can } = useWorkspace();
  const toast = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const pages = useApi<{ pages: Page[]; metaConfigured: boolean }>("/api/v1/pages");
  const agents = useApi<{ agents: Agent[] }>("/api/v1/agents");
  const [connecting, setConnecting] = useState(false);
  const [selectToken, setSelectToken] = useState<string | null>(sp.get("select"));
  const [configPage, setConfigPage] = useState<Page | null>(null);
  const [disconnectPage, setDisconnectPage] = useState<Page | null>(null);
  const error = sp.get("error");

  useEffect(() => {
    if (sp.get("select")) {
      setSelectToken(sp.get("select"));
      router.replace(`/app/${workspace.slug}/pages`);
    }
  }, [sp, router, workspace.slug]);

  async function connect() {
    setConnecting(true);
    try {
      const r = await api.post<{ url: string }>("/api/meta/connect");
      window.location.href = r.url;
    } catch (err) {
      toast.error("Could not start Facebook connection", err instanceof ApiError ? err.message : undefined);
      setConnecting(false);
    }
  }

  const list = pages.data?.pages ?? [];
  const active = list.filter((p) => p.status !== "DISCONNECTED");
  const disconnected = list.filter((p) => p.status === "DISCONNECTED");

  return (
    <div className="space-y-6">
      <PageHeader title="Facebook Pages" description="Connect authorised Pages, verify webhooks, and configure moderation and reply behaviour per Page." actions={can("pages.manage") ? <Button onClick={connect} loading={connecting} disabled={pages.data ? !pages.data.metaConfigured : true}><Plug className="h-4 w-4" /> Connect with Facebook</Button> : null} />
      {error ? <Alert tone="danger" title="Facebook connection failed">{error}</Alert> : null}
      {pages.data && !pages.data.metaConfigured ? <Alert tone="warning" title="Meta app not configured">The server has no META_APP_ID / META_APP_SECRET. Follow README → Meta App integration, then restart the app.</Alert> : null}
      {pages.loading ? <LoadingBlock rows={3} /> : !active.length ? (
        <EmptyState icon={<Globe className="h-6 w-6" />} title="No Pages connected yet" description="Connect with Facebook, choose the Pages you manage, and we will subscribe to comment and message events. Moderation starts in shadow mode — nothing changes on Facebook until you decide." action={can("pages.manage") ? <Button onClick={connect} loading={connecting} disabled={!pages.data?.metaConfigured}>Connect with Facebook</Button> : undefined} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {active.map((p) => <PageCard key={p.id} page={p} onConfigure={() => setConfigPage(p)} onDisconnect={() => setDisconnectPage(p)} canManage={can("pages.manage")} canDisconnect={can("pages.disconnect")} />)}
        </div>
      )}
      {disconnected.length ? (
        <Card>
          <div className="text-[13px] font-semibold uppercase tracking-wider text-text-3">Disconnected (history preserved)</div>
          <ul className="mt-3 divide-y divide-border">
            {disconnected.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2.5 text-sm"><span className="text-text-2">{p.name}</span><span className="text-[12px] text-text-3">{p._count.comments} comments · disconnected {timeAgo(p.connectedAt)}</span></li>
            ))}
          </ul>
        </Card>
      ) : null}
      {selectToken ? <SelectPagesDialog token={selectToken} onClose={() => setSelectToken(null)} onDone={() => { setSelectToken(null); pages.refresh(); }} /> : null}
      {configPage ? <ConfigDialog page={configPage} agents={agents.data?.agents ?? []} canAutomate={can("pages.automation")} onClose={() => setConfigPage(null)} onSaved={() => { setConfigPage(null); pages.refresh(); }} /> : null}
      {disconnectPage ? <DisconnectDialog page={disconnectPage} onClose={() => setDisconnectPage(null)} onDone={() => { setDisconnectPage(null); pages.refresh(); }} /> : null}
    </div>
  );
}

function PageCard({ page, onConfigure, onDisconnect, canManage, canDisconnect }: { page: Page; onConfigure: () => void; onDisconnect: () => void; canManage: boolean; canDisconnect: boolean }) {
  const healthy = page.status === "CONNECTED" && page.webhookSubscribed && !page.healthError;
  const mode = page.killSwitch ? { label: "Paused", tone: "danger" as const } : page.moderationMode === "AUTO" ? { label: page.autoHideEnabled ? "Automatic" : "Auto (hide off)", tone: "success" as const } : page.moderationMode === "APPROVAL" ? { label: "Human approval", tone: "primary" as const } : { label: "Shadow mode", tone: "neutral" as const };
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Avatar name={page.name} src={page.pictureUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold text-text">{page.name}</h3>
            <Badge tone={mode.tone}>{mode.label}</Badge>
          </div>
          <div className="mt-0.5 text-[12px] text-text-3">{page.category ?? "Page"} · ID {page.fbPageId} · connected {timeAgo(page.connectedAt)}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[12.5px]">
        <div className="flex items-center gap-1.5 rounded-sm bg-surface-2 px-2.5 py-2">{healthy ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-warning" />}<span className="text-text-2">{page.status === "CONNECTED" ? "Token valid" : page.status.replace("_", " ").toLowerCase()}</span></div>
        <div className="flex items-center gap-1.5 rounded-sm bg-surface-2 px-2.5 py-2">{page.webhookSubscribed ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-warning" />}<span className="text-text-2">Webhook {page.webhookSubscribed ? `(${page.webhookFields.join(", ") || "feed"})` : "not verified"}</span></div>
        <div className="rounded-sm bg-surface-2 px-2.5 py-2 text-text-2">Replies: <span className="font-medium text-text">{page.replyMode === "OFF" ? "Off" : page.replyMode === "SUGGEST" ? "Suggest" : page.replyMode === "APPROVAL" ? "Approval" : "Limited auto"}</span></div>
        <div className="rounded-sm bg-surface-2 px-2.5 py-2 text-text-2">{page._count.comments} comments · {page._count.conversations} chats</div>
      </div>
      {page.missingScopes.length ? <Alert tone="warning">Missing permissions: {page.missingScopes.join(", ")}. Reconnect to grant them.</Alert> : null}
      {page.healthError ? <Alert tone="danger">{page.healthError}</Alert> : null}
      <div className="mt-auto flex flex-wrap gap-2">
        {canManage ? <Button variant="outline" size="sm" onClick={onConfigure}><Settings2 className="h-4 w-4" /> Configure</Button> : null}
        {page.status !== "CONNECTED" && canManage ? <Button variant="soft" size="sm" onClick={() => api.post<{ url: string }>("/api/meta/connect").then((r) => (window.location.href = r.url))}><RefreshCw className="h-4 w-4" /> Reconnect</Button> : null}
        {canDisconnect ? <Button variant="ghost" size="sm" className="ml-auto text-danger hover:bg-danger-soft" onClick={onDisconnect}><Trash2 className="h-4 w-4" /> Disconnect Page</Button> : null}
      </div>
    </Card>
  );
}

function SelectPagesDialog({ token, onClose, onDone }: { token: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const data = useApi<{ granted: string[]; pages: { id: string; name: string; category?: string; pictureUrl?: string; alreadyConnected: boolean; connectedElsewhere: boolean }[] }>(`/api/meta/select?token=${encodeURIComponent(token)}`);
  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<{ name: string; status: string; webhookSubscribed: boolean; error?: string }[] | null>(null);
  async function connect() {
    setSaving(true);
    try {
      const r = await api.post<{ results: typeof results }>("/api/meta/select", { token, pageIds: chosen });
      setResults(r.results);
      toast.success("Pages connected");
    } catch (err) {
      toast.error("Connection failed", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }
  const missingMessaging = data.data && !data.data.granted.includes("pages_messaging");
  return (
    <Dialog open onClose={results ? onDone : onClose} title="Choose Pages to connect" description="Only Pages where you have a moderation role are listed. Tokens are stored encrypted." footer={results ? <Button onClick={onDone}>Done</Button> : <><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={connect} disabled={!chosen.length} loading={saving}>Connect {chosen.length || ""} Page{chosen.length === 1 ? "" : "s"}</Button></>}>
      {data.error ? <Alert tone="danger">{data.error}</Alert> : data.loading ? <LoadingBlock rows={3} /> : results ? (
        <ul className="space-y-2">
          {results.map((r) => (
            <li key={r.name} className="flex items-center justify-between rounded-sm border border-border px-3 py-2 text-sm"><span>{r.name}</span>{r.error ? <Badge tone="danger">{r.error}</Badge> : <Badge tone={r.webhookSubscribed ? "success" : "warning"}>{r.webhookSubscribed ? "Connected · webhook verified" : "Connected · webhook not verified"}</Badge>}</li>
          ))}
        </ul>
      ) : (
        <div className="space-y-3">
          {missingMessaging ? <Alert tone="warning">The pages_messaging permission was not granted. Comment moderation will work; Messenger inbox will stay read-only until you reconnect with messaging permission.</Alert> : null}
          {data.data!.pages.map((p) => (
            <label key={p.id} className={`flex items-center gap-3 rounded-sm border px-3 py-2.5 ${p.connectedElsewhere ? "opacity-50" : "cursor-pointer hover:bg-surface-2"} ${chosen.includes(p.id) ? "border-primary bg-primary-soft/40" : "border-border"}`}>
              <Checkbox checked={chosen.includes(p.id)} onChange={(v) => !p.connectedElsewhere && setChosen((c) => (v ? [...c, p.id] : c.filter((x) => x !== p.id)))} />
              <Avatar name={p.name} src={p.pictureUrl} size="sm" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-text">{p.name}</span><span className="block text-[12px] text-text-3">{p.category ?? "Page"} · {p.id}</span></span>
              {p.alreadyConnected ? <Badge tone="primary">Reconnect</Badge> : p.connectedElsewhere ? <Badge tone="warning">Used by another workspace</Badge> : null}
            </label>
          ))}
          {!data.data!.pages.length ? <EmptyState title="No Pages found" description="Your Facebook account has no Pages with a moderation role, or none were selected in the Facebook dialog." /> : null}
        </div>
      )}
    </Dialog>
  );
}

function ConfigDialog({ page, agents, canAutomate, onClose, onSaved }: { page: Page; agents: Agent[]; canAutomate: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ moderationMode: page.moderationMode, autoHideEnabled: page.autoHideEnabled, killSwitch: page.killSwitch, replyMode: page.replyMode, moderationAgentId: page.moderationAgentId ?? "", replyAgentId: page.replyAgentId ?? "", messengerAgentId: page.messengerAgentId ?? "", settings: page.settings });
  const [saving, setSaving] = useState(false);
  const cat = (k: string) => form.settings.categories[k] ?? { autoHide: false, threshold: 0.9 };
  const setCat = (k: string, v: Partial<{ autoHide: boolean; threshold: number }>) => setForm((f) => ({ ...f, settings: { ...f.settings, categories: { ...f.settings.categories, [k]: { ...cat(k), ...v } } } }));
  async function save() {
    setSaving(true);
    try {
      await api.patch(`/api/v1/pages/${page.id}/config`, { ...form, moderationAgentId: form.moderationAgentId || null, replyAgentId: form.replyAgentId || null, messengerAgentId: form.messengerAgentId || null });
      toast.success("Page settings saved");
      onSaved();
    } catch (err) {
      toast.error("Could not save", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }
  const byPurpose = (p: string) => agents.filter((a) => a.purpose === p && a.status === "ACTIVE");
  return (
    <Dialog open onClose={onClose} title={`Configure ${page.name}`} description="Changes apply to new comments immediately. Automation requires the pages.automation permission." size="lg" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>Save settings</Button></>}>
      <div className="space-y-6">
        <section className="space-y-3">
          <h4 className="text-[13px] font-semibold uppercase tracking-wider text-text-3">Emergency</h4>
          <Switch checked={form.killSwitch} onChange={(v) => setForm((f) => ({ ...f, killSwitch: v }))} disabled={!canAutomate} label="Kill switch — pause all automated actions for this Page" description="Analysis continues; nothing is hidden or replied automatically while on." />
        </section>
        <section className="space-y-3">
          <h4 className="text-[13px] font-semibold uppercase tracking-wider text-text-3">Moderation mode</h4>
          <div className="grid gap-2 sm:grid-cols-3">
            {([["SHADOW", "Shadow", "Analyse only. Nothing changes on Facebook."], ["APPROVAL", "Human approval", "AI recommends; your team approves each hide/reply."], ["AUTO", "Automatic", "AI may hide approved categories above thresholds."]] as const).map(([v, l, d]) => (
              <button key={v} type="button" disabled={v === "AUTO" && !canAutomate} onClick={() => setForm((f) => ({ ...f, moderationMode: v }))} className={`rounded-sm border p-3 text-left transition-colors disabled:opacity-50 ${form.moderationMode === v ? "border-primary bg-primary-soft/40" : "border-border hover:bg-surface-2"}`}>
                <div className="text-sm font-medium text-text">{l}</div>
                <div className="mt-0.5 text-[12px] text-text-2">{d}</div>
              </button>
            ))}
          </div>
          {form.moderationMode === "AUTO" ? (
            <div className="space-y-3 rounded-sm border border-border p-4">
              <Switch checked={form.autoHideEnabled} onChange={(v) => setForm((f) => ({ ...f, autoHideEnabled: v }))} disabled={!canAutomate} label="Enable automatic hiding on this Page" description="Off by default. Only the categories below, above their thresholds, within hourly caps. Complaints and negative reviews are never auto-hidden." />
              <div className="grid gap-2 sm:grid-cols-2">
                {HIDE_CATS.map((k) => (
                  <div key={k} className="flex items-center justify-between gap-2 rounded-xs bg-surface-2 px-3 py-2">
                    <Checkbox checked={cat(k).autoHide} onChange={(v) => setCat(k, { autoHide: v })} label={<span className="text-[13px]">{k.replace(/_/g, " ")}</span>} />
                    <div className="flex items-center gap-1.5 text-[12px] text-text-2">≥ <Input type="number" min={0.5} max={1} step={0.01} value={cat(k).threshold} onChange={(e) => setCat(k, { threshold: Number(e.target.value) })} className="h-7 w-[72px] px-2 text-[12px]" /></div>
                  </div>
                ))}
              </div>
              <Field label="Max automatic hides per hour" hint="Platform safety cap also applies."><Input type="number" min={1} max={500} value={form.settings.maxAutoHidesPerHour} onChange={(e) => setForm((f) => ({ ...f, settings: { ...f.settings, maxAutoHidesPerHour: Number(e.target.value) } }))} className="w-32" /></Field>
            </div>
          ) : null}
        </section>
        <section className="space-y-3">
          <h4 className="text-[13px] font-semibold uppercase tracking-wider text-text-3">Public replies</h4>
          <Select value={form.replyMode} onChange={(e) => setForm((f) => ({ ...f, replyMode: e.target.value as Page["replyMode"] }))}>
            <option value="OFF">Off</option>
            <option value="SUGGEST">Suggest reply (staff send manually)</option>
            <option value="APPROVAL">Human-approved reply (queued for approval)</option>
            <option value="LIMITED_AUTO" disabled={!canAutomate}>Limited automatic reply</option>
          </Select>
          {form.replyMode === "LIMITED_AUTO" ? (
            <div className="space-y-3 rounded-sm border border-border p-4">
              <div className="text-[13px] text-text-2">Automatically reply only to:</div>
              <div className="flex flex-wrap gap-2">
                {REPLY_CATS.map((k) => <Checkbox key={k} checked={form.settings.autoReplyCategories.includes(k)} onChange={(v) => setForm((f) => ({ ...f, settings: { ...f.settings, autoReplyCategories: v ? [...f.settings.autoReplyCategories, k] : f.settings.autoReplyCategories.filter((x) => x !== k) } }))} label={<span className="text-[13px]">{k.replace(/_/g, " ")}</span>} />)}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Minimum confidence"><Input type="number" min={0.5} max={1} step={0.01} value={form.settings.replyMinConfidence} onChange={(e) => setForm((f) => ({ ...f, settings: { ...f.settings, replyMinConfidence: Number(e.target.value) } }))} /></Field>
                <Field label="Max automatic replies per hour"><Input type="number" min={1} max={500} value={form.settings.maxAutoRepliesPerHour} onChange={(e) => setForm((f) => ({ ...f, settings: { ...f.settings, maxAutoRepliesPerHour: Number(e.target.value) } }))} /></Field>
              </div>
            </div>
          ) : null}
        </section>
        <section className="space-y-3">
          <h4 className="text-[13px] font-semibold uppercase tracking-wider text-text-3">Agents</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Moderation agent"><Select value={form.moderationAgentId} onChange={(e) => setForm((f) => ({ ...f, moderationAgentId: e.target.value }))}><option value="">Workspace default</option>{byPurpose("MODERATION").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
            <Field label="Reply agent"><Select value={form.replyAgentId} onChange={(e) => setForm((f) => ({ ...f, replyAgentId: e.target.value }))}><option value="">Workspace default</option>{byPurpose("PUBLIC_REPLY").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
            <Field label="Messenger agent"><Select value={form.messengerAgentId} onChange={(e) => setForm((f) => ({ ...f, messengerAgentId: e.target.value }))}><option value="">Workspace default</option>{byPurpose("MESSENGER").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          </div>
          <Switch checked={form.settings.notifyOnIncidents} onChange={(v) => setForm((f) => ({ ...f, settings: { ...f.settings, notifyOnIncidents: v } }))} label="Notify managers about high-risk or harassment incidents" />
        </section>
      </div>
    </Dialog>
  );
}

function DisconnectDialog({ page, onClose, onDone }: { page: Page; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  async function go() {
    setLoading(true);
    try {
      const r = await api.post<{ webhookRemoved: boolean }>(`/api/v1/pages/${page.id}/disconnect`, { confirmName: name });
      toast.success(`${page.name} disconnected`, r.webhookRemoved ? "Webhook subscription removed." : "Webhook removal could not be confirmed; remove the app from Page settings if needed.");
      onDone();
    } catch (err) {
      toast.error("Disconnect failed", err instanceof ApiError ? err.message : undefined);
      setLoading(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Disconnect "${page.name}"?`} description={`Page ID ${page.fbPageId}. Other Pages are not affected.`} size="sm" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={go} loading={loading} disabled={name.trim() !== page.name.trim()}><PauseCircle className="h-4 w-4" /> Disconnect Page</Button></>}>
      <ul className="mb-4 list-disc space-y-1 pl-5 text-[13px] text-text-2">
        <li>AI moderation and replies stop immediately</li>
        <li>Stored Page credentials are deleted and the webhook subscription removed</li>
        <li>Pending actions are cancelled</li>
        <li>Comments, reports and CRM records are preserved</li>
      </ul>
      <Field label={`Type the Page name to confirm: ${page.name}`}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={page.name} /></Field>
    </Dialog>
  );
}

export default function PagesScreen() {
  return <Suspense fallback={<div className="skeleton h-64 rounded-card" />}><PagesScreenInner /></Suspense>;
}
