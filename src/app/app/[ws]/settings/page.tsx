"use client";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, KeyValue, LoadingBlock, PageHeader, Select, Switch, Table, Tabs, Td, Textarea, Th, useToast } from "@/components/ui";
import { useWorkspace } from "@/components/app/workspace-context";
import { useApi } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/utils";

type WsSettings = { workspace: { id: string; slug: string; name: string; type: string; status: string; timezone: string; defaultLocale: string; businessProfile: Record<string, string>; emergencyPause: boolean; aiCredentialMode: string }; role: string | null; permissions: string[] };
type Creds = { mode: string; provider: string | null; credentials: { id: string; provider: string; label: string; keyLast4: string; status: string; lastVerifiedAt: string | null; lastError: string | null }[]; platformProviders: string[]; allowPlatformFallback: boolean };

export default function SettingsPage() {
  const { can, user } = useWorkspace();
  const [tab, setTab] = useState<"business" | "ai" | "security" | "replies" | "audit">("business");
  const s = useApi<WsSettings>("/api/v1/settings/workspace");
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Business profile, AI providers, security and audit history." />
      <Tabs value={tab} onChange={setTab} items={[{ value: "business", label: "Business" }, { value: "ai", label: "AI providers" }, { value: "replies", label: "Saved replies" }, { value: "security", label: "Security" }, ...(can("audit.view") ? [{ value: "audit" as const, label: "Audit log" }] : [])]} />
      {tab === "business" ? (s.data ? <BusinessForm data={s.data} canEdit={can("settings.manage")} onSaved={() => s.refresh()} /> : <LoadingBlock />) : null}
      {tab === "ai" ? <AiSettings canEdit={can("ai.credentials")} /> : null}
      {tab === "replies" ? <SavedReplies /> : null}
      {tab === "security" ? <Security canManage={can("settings.manage")} userEmail={user.email} /> : null}
      {tab === "audit" ? <AuditLog /> : null}
      {s.error ? <Alert tone="danger">{s.error}</Alert> : null}
    </div>
  );
}

function BusinessForm({ data, canEdit, onSaved }: { data: WsSettings; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const w = data.workspace;
  const [f, setF] = useState({ name: w.name, timezone: w.timezone, defaultLocale: w.defaultLocale, emergencyPause: w.emergencyPause, profile: { displayName: "", description: "", phone: "", email: "", website: "", address: "", industry: "", officialContactLine: "", ...w.businessProfile } });
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await api.patch("/api/v1/settings/workspace", { name: f.name, timezone: f.timezone, defaultLocale: f.defaultLocale, emergencyPause: f.emergencyPause, businessProfile: f.profile });
      toast.success("Settings saved");
      onSaved();
    } catch (err) {
      toast.error("Could not save", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }
  const p = <K extends keyof typeof f.profile>(k: K) => ({ value: f.profile[k] ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, profile: { ...x.profile, [k]: e.target.value } })) });
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Business profile" description="Used in AI replies, emails and invoices." action={canEdit ? <Button onClick={save} loading={saving}>Save changes</Button> : null} />
        <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Workspace name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Public display name" hint="How the AI refers to the business"><Input {...p("displayName")} /></Field>
          <Field label="Industry"><Input {...p("industry")} placeholder="Overseas employment agency" /></Field>
          <Field label="Phone"><Input {...p("phone")} /></Field>
          <Field label="Email"><Input type="email" {...p("email")} /></Field>
          <Field label="Website"><Input {...p("website")} placeholder="https://" /></Field>
          <div className="sm:col-span-2"><Field label="Address"><Input {...p("address")} /></Field></div>
          <div className="sm:col-span-2"><Field label="Official contact line" hint="What the AI says when it cannot answer: e.g. 'Call 01XXXXXXXXX or visit our Naya Paltan office.'"><Textarea {...p("officialContactLine")} className="font-bengali min-h-[64px]" /></Field></div>
          <div className="sm:col-span-2"><Field label="Description"><Textarea {...p("description")} className="font-bengali" /></Field></div>
          <Field label="Timezone"><Select value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>{["Asia/Dhaka", "Asia/Riyadh", "Asia/Dubai", "Asia/Kuala_Lumpur", "UTC", "Europe/London", "America/New_York"].map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Default language for emails"><Select value={f.defaultLocale} onChange={(e) => setF({ ...f, defaultLocale: e.target.value })}><option value="en">English</option><option value="bn">বাংলা</option></Select></Field>
        </fieldset>
      </Card>
      <div className="space-y-5">
        <Card className={f.emergencyPause ? "border-danger/40" : ""}>
          <CardHeader title="Emergency pause" description="Immediately stops every automated Facebook action for all Pages in this workspace. Analysis continues." />
          <Switch checked={f.emergencyPause} onChange={(v) => setF({ ...f, emergencyPause: v })} disabled={!canEdit} label={f.emergencyPause ? "Automation is PAUSED" : "Automation allowed"} />
          {canEdit ? <Button variant={f.emergencyPause ? "danger" : "outline"} className="mt-3 w-full" onClick={save} loading={saving}>{f.emergencyPause !== w.emergencyPause ? "Apply" : "Saved"}</Button> : null}
        </Card>
        <Card><CardHeader title="Workspace" /><KeyValue items={[{ k: "Type", v: w.type.toLowerCase() }, { k: "Status", v: <Badge tone={w.status === "ACTIVE" ? "success" : "warning"}>{w.status.toLowerCase()}</Badge> }, { k: "Your role", v: data.role ?? "platform" }, { k: "Slug", v: w.slug }]} /></Card>
      </div>
    </div>
  );
}

function AiSettings({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const d = useApi<Creds>(canEdit ? "/api/v1/ai/credentials" : null);
  const [provider, setProvider] = useState("openai");
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  if (!canEdit) return <Alert tone="info">Only owners and admins can manage AI provider keys.</Alert>;
  if (!d.data) return <LoadingBlock />;
  const x = d.data;
  async function addKey() {
    setSaving(true);
    try {
      await api.post("/api/v1/ai/credentials", { provider, apiKey: key, label });
      toast.success("API key verified and stored encrypted");
      setKey("");
      d.refresh();
    } catch (err) {
      toast.error("Key rejected", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }
  const setMode = async (mode: "PLATFORM" | "BYOK") => {
    try {
      await api.patch("/api/v1/ai/credentials", { mode });
      toast.success(`Switched to ${mode === "BYOK" ? "your own keys" : "platform-managed AI"}`);
      d.refresh();
    } catch (err) {
      toast.error("Could not switch", err instanceof ApiError ? err.message : undefined);
    }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Credential mode" description="Platform-managed AI counts toward your plan's AI allowance. Bring Your Own Key bills your provider account directly; requests are still counted and rate-limited." />
        <div className="grid gap-2">
          {([["PLATFORM", "Platform-managed", x.platformProviders.length ? `Available: ${x.platformProviders.join(", ")}` : "No platform providers configured on this server"], ["BYOK", "Bring Your Own Key", x.credentials.filter((c) => c.status === "ACTIVE").length ? "Using your keys below" : "Add a key first"]] as const).map(([v, l, h]) => <button key={v} onClick={() => setMode(v)} className={`rounded-sm border p-3 text-left ${x.mode === v ? "border-primary bg-primary-soft/40" : "border-border hover:bg-surface-2"}`}><div className="text-sm font-medium text-text">{l}</div><div className="text-[12px] text-text-2">{h}</div></button>)}
        </div>
        <Field label="Preferred provider" hint="Agents can override this per version."><Select value={x.provider ?? ""} onChange={(e) => api.patch("/api/v1/ai/credentials", { provider: e.target.value || null }).then(() => d.refresh())}><option value="">Platform default</option><option value="openai">OpenAI</option><option value="gemini">Google Gemini</option><option value="deepseek">DeepSeek</option></Select></Field>
        {x.mode === "BYOK" ? <Alert tone="info" className="mt-3">{x.allowPlatformFallback ? "If your key fails, the platform may temporarily cover requests (enabled by the platform admin)." : "If your key fails, AI processing pauses — it never silently falls back to platform credits."}</Alert> : null}
      </Card>
      <Card>
        <CardHeader title="Your API keys" description="Keys are verified with a tiny test request before being stored with authenticated encryption. Only the last 4 characters are shown." />
        <ul className="mb-4 divide-y divide-border text-sm">{x.credentials.map((c) => <li key={c.id} className="flex items-center justify-between py-2"><span><span className="font-medium text-text">{c.provider}</span> <span className="text-text-2">…{c.keyLast4}{c.label ? ` · ${c.label}` : ""}</span>{c.lastError ? <span className="block text-[12px] text-danger">{c.lastError}</span> : null}</span><span className="flex items-center gap-2"><Badge tone={c.status === "ACTIVE" ? "success" : "danger"}>{c.status.toLowerCase()}</Badge>{c.status === "ACTIVE" ? <Button size="sm" variant="ghost" className="text-danger" onClick={() => api.delete(`/api/v1/ai/credentials/${c.id}`).then(() => d.refresh())}>Revoke</Button> : null}</span></li>)}{!x.credentials.length ? <li className="py-2 text-text-3">No keys added.</li> : null}</ul>
        <div className="grid gap-3 sm:grid-cols-3"><Field label="Provider"><Select value={provider} onChange={(e) => setProvider(e.target.value)}><option value="openai">OpenAI</option><option value="gemini">Google Gemini</option><option value="deepseek">DeepSeek</option></Select></Field><div className="sm:col-span-2"><Field label="API key"><Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" autoComplete="off" /></Field></div><div className="sm:col-span-2"><Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Finance team key" /></Field></div><div className="flex items-end"><Button onClick={addKey} loading={saving} disabled={key.length < 10} className="w-full">Verify & add</Button></div></div>
      </Card>
    </div>
  );
}

function SavedReplies() {
  const toast = useToast();
  const d = useApi<{ replies: { id: string; title: string; body: string; shortcut: string | null }[] }>("/api/v1/inbox/saved-replies");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card><CardHeader title="Saved replies" description="Quick responses for the Messenger inbox." /><ul className="divide-y divide-border text-sm">{d.data?.replies.map((r) => <li key={r.id} className="flex items-start justify-between gap-3 py-2.5"><span><span className="font-medium text-text">{r.title}</span><span className="block font-bengali text-[13px] text-text-2">{r.body}</span></span><Button size="sm" variant="ghost" className="text-danger" onClick={() => api.delete("/api/v1/inbox/saved-replies", { id: r.id }).then(() => d.refresh())}>Delete</Button></li>)}{!d.data?.replies.length ? <li className="py-2 text-text-3">None yet.</li> : null}</ul></Card>
      <Card><CardHeader title="Add saved reply" /><div className="space-y-3"><Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Office hours" /></Field><Field label="Text"><Textarea value={body} onChange={(e) => setBody(e.target.value)} className="font-bengali" placeholder="আমাদের অফিস শনিবার থেকে বৃহস্পতিবার সকাল ১০টা থেকে সন্ধ্যা ৬টা পর্যন্ত খোলা।" /></Field><Button disabled={!title || !body} onClick={async () => { try { await api.post("/api/v1/inbox/saved-replies", { title, body }); setTitle(""); setBody(""); d.refresh(); toast.success("Saved"); } catch (err) { toast.error("Failed", err instanceof ApiError ? err.message : undefined); } }}>Save reply</Button></div></Card>
    </div>
  );
}

function Security({ canManage, userEmail }: { canManage: boolean; userEmail: string }) {
  const toast = useToast();
  const sessions = useApi<{ sessions: { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean }[] }>("/api/v1/auth/sessions");
  const grants = useApi<{ grants: { id: string; reason: string; scope: string; status: string; expiresAt: string | null; createdAt: string }[] }>(canManage ? "/api/v1/settings/security/support-access" : null);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [saving, setSaving] = useState(false);
  async function changePw() {
    if (pw.next !== pw.confirm) return toast.error("Passwords do not match");
    setSaving(true);
    try {
      await api.post("/api/v1/auth/change-password", { currentPassword: pw.current, newPassword: pw.next });
      toast.success("Password changed", "Other sessions were signed out.");
      setPw({ current: "", next: "", confirm: "" });
      sessions.refresh();
    } catch (err) {
      toast.error("Could not change password", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card><CardHeader title="Change password" description={`Signed in as ${userEmail}`} /><div className="space-y-3"><Field label="Current password"><Input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></Field><Field label="New password" hint="At least 10 characters with letters and numbers"><Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></Field><Field label="Confirm"><Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" /></Field><Button onClick={changePw} loading={saving} disabled={!pw.current || pw.next.length < 10}>Update password</Button></div></Card>
      <Card><CardHeader title="Active sessions" action={<Button size="sm" variant="outline" onClick={() => api.delete("/api/v1/auth/sessions").then((r) => { toast.success(`${(r as { revoked: number }).revoked} sessions signed out`); sessions.refresh(); })}>Sign out other sessions</Button>} /><ul className="divide-y divide-border text-sm">{sessions.data?.sessions.map((s) => <li key={s.id} className="py-2.5"><div className="flex items-center gap-2"><span className="truncate text-text">{s.userAgent?.slice(0, 70) ?? "Unknown device"}</span>{s.current ? <Badge tone="success">this device</Badge> : null}</div><div className="text-[12px] text-text-3">{s.ip ?? "—"} · signed in {formatDate(s.createdAt, true)} · active {timeAgo(s.lastSeenAt)}</div></li>)}</ul></Card>
      {canManage ? (
        <Card className="lg:col-span-2">
          <CardHeader title="Platform support access" description="Platform staff can only read your private Messenger conversations after you approve a time-boxed request here. Every access is logged." />
          <ul className="divide-y divide-border text-sm">{grants.data?.grants.map((g) => <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5"><span><span className="text-text">{g.reason}</span><span className="block text-[12px] text-text-3">{g.scope} · requested {timeAgo(g.createdAt)}{g.expiresAt ? ` · expires ${formatDate(g.expiresAt, true)}` : ""}</span></span><span className="flex items-center gap-2"><Badge tone={g.status === "APPROVED" ? "success" : g.status === "REQUESTED" ? "warning" : "neutral"}>{g.status.toLowerCase()}</Badge>{g.status === "REQUESTED" ? <><Button size="sm" onClick={() => api.post("/api/v1/settings/security/support-access", { grantId: g.id, approve: true, hours: 24 }).then(() => grants.refresh())}>Approve 24h</Button><Button size="sm" variant="outline" onClick={() => api.post("/api/v1/settings/security/support-access", { grantId: g.id, approve: false }).then(() => grants.refresh())}>Deny</Button></> : null}</span></li>)}{!grants.data?.grants.length ? <li className="py-2 text-text-3">No access requests.</li> : null}</ul>
        </Card>
      ) : null}
    </div>
  );
}

function AuditLog() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const d = useApi<{ rows: { id: string; action: string; targetType: string | null; targetId: string | null; createdAt: string; actor: { name: string; email: string } | null; actorType: string; meta: Record<string, unknown> }[]; total: number; pageSize: number }>(`/api/v1/audit-logs?page=${page}${action ? `&action=${action}` : ""}`);
  useEffect(() => setPage(1), [action]);
  return (
    <Card padded={false}>
      <div className="flex items-center gap-3 border-b border-border p-4"><Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Filter by action, e.g. page.disconnected" className="w-72" /></div>
      {d.loading && !d.data ? <div className="p-4"><LoadingBlock /></div> : <Table className="rounded-none border-0 shadow-none"><thead><tr><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Target</Th><Th>Details</Th></tr></thead><tbody>{d.data?.rows.map((r) => <tr key={r.id}><Td className="whitespace-nowrap text-text-2">{formatDate(r.createdAt, true)}</Td><Td>{r.actor ? <span>{r.actor.name}<span className="block text-[11px] text-text-3">{r.actor.email}</span></span> : <Badge tone="outline">{r.actorType.toLowerCase()}</Badge>}</Td><Td><code className="rounded bg-surface-2 px-1.5 py-0.5 text-[12px]">{r.action}</code></Td><Td className="text-text-2">{r.targetType ? `${r.targetType} ${r.targetId?.slice(-6) ?? ""}` : "—"}</Td><Td className="max-w-md truncate text-[12px] text-text-3" title={JSON.stringify(r.meta)}>{JSON.stringify(r.meta).slice(0, 120)}</Td></tr>)}</tbody></Table>}
      <div className="px-4 pb-4"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button> <Button variant="outline" size="sm" disabled={(d.data?.total ?? 0) <= page * (d.data?.pageSize ?? 50)} onClick={() => setPage(page + 1)}>Next</Button></div>
    </Card>
  );
}
