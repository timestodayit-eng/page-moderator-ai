"use client";
import { useState } from "react";
import { Send, Eye, RotateCcw, Mail } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Field, Input, LoadingBlock, PageHeader, Pagination, Select, Stat, Table, Tabs, Td, Textarea, Th, useToast } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/utils";

type Delivery = { id: string; toEmail: string; templateKey: string; locale: string; category: string; subject: string; status: string; attempts: number; lastError: string | null; provider: string | null; scheduledAt: string; sentAt: string | null; createdAt: string; campaignId: string | null };
type Template = { id: string; key: string; locale: string; category: string; subject: string; body: string; ctaLabel: string | null; isActive: boolean };

export default function EmailCenter() {
  const toast = useToast();
  const [tab, setTab] = useState<"send" | "deliveries" | "templates" | "campaigns">("send");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const deliveries = useApi<{ rows: Delivery[]; total: number; pageSize: number; stats: Record<string, number> }>(`/api/v1/platform/email/deliveries?page=${page}${status ? `&status=${status}` : ""}`);
  const templates = useApi<{ templates: Template[] }>("/api/v1/platform/email/templates");
  const campaigns = useApi<{ campaigns: { id: string; name: string; templateKey: string; status: string; recipientCount: number; scheduledAt: string | null; sentAt: string | null; createdAt: string }[] }>("/api/v1/platform/email/campaigns");
  const workspaces = useApi<{ rows: { id: string; name: string }[] }>("/api/v1/platform/workspaces?pageSize=100");
  const [f, setF] = useState({ name: "", templateKey: "platform.notice", subject: "", message: "", recipients: "allOwners" as "allOwners" | "workspaces", workspaceIds: [] as string[], scheduledAt: "" });
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [recipientPreview, setRecipientPreview] = useState<{ recipients: number; sample: { email: string; workspace: string }[] } | null>(null);
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [editTpl, setEditTpl] = useState<Template | null>(null);
  const stats = deliveries.data?.stats ?? {};
  const filter = f.recipients === "allOwners" ? { allOwners: true } : { workspaceIds: f.workspaceIds, allOwners: true };
  async function doPreview() {
    try {
      const r = await api.post<{ subject: string; html: string }>("/api/v1/platform/email/test", { templateKey: f.templateKey, preview: true, vars: { subject: f.subject, message: f.message } });
      setPreview(r);
      setRecipientPreview(await api.post("/api/v1/platform/email/campaigns", { name: f.name || "preview", templateKey: f.templateKey, recipientFilter: filter, vars: {}, previewOnly: true }));
    } catch (err) {
      toast.error("Preview failed", err instanceof ApiError ? err.message : undefined);
    }
  }
  async function send(now: boolean) {
    setBusy(true);
    try {
      const r = await api.post<{ recipients: number }>("/api/v1/platform/email/campaigns", { name: f.name || f.subject, templateKey: f.templateKey, recipientFilter: filter, vars: { subject: f.subject, message: f.message }, sendNow: now, scheduledAt: !now && f.scheduledAt ? new Date(f.scheduledAt).toISOString() : undefined });
      toast.success(now ? `Queued to ${r.recipients} recipients` : `Scheduled for ${r.recipients} recipients`);
      campaigns.refresh();
      deliveries.refresh();
    } catch (err) {
      toast.error("Could not send", err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <PageHeader title="Email Management" description="Service notices, delivery history, retries and template editing (English + Bengali)." />
      <div className="grid gap-4 sm:grid-cols-4"><Stat label="Sent (30d)" value={stats.SENT ?? 0} tone="success" /><Stat label="Queued" value={stats.QUEUED ?? 0} /><Stat label="Failed" value={stats.FAILED ?? 0} tone={stats.FAILED ? "danger" : undefined} /><Stat label="Suppressed" value={stats.SUPPRESSED ?? 0} /></div>
      <Tabs value={tab} onChange={setTab} items={[{ value: "send", label: "Send notice" }, { value: "deliveries", label: "Delivery history" }, { value: "campaigns", label: "Campaigns", count: campaigns.data?.campaigns.length }, { value: "templates", label: "Templates" }]} />
      {tab === "send" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Compose service notice" description="Transactional notices reach workspace owners regardless of marketing preferences. Bengali or English is chosen per recipient." />
            <div className="space-y-3">
              <Field label="Internal name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Maintenance notice Nov 2026" /></Field>
              <Field label="Template"><Select value={f.templateKey} onChange={(e) => setF({ ...f, templateKey: e.target.value })}>{[...new Set(templates.data?.templates.map((t) => t.key) ?? ["platform.notice"])].map((k) => <option key={k} value={k}>{k}</option>)}</Select></Field>
              <Field label="Subject"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
              <Field label="Message" hint="Blank line = paragraph. Lines starting with '> ' render as a highlighted note."><Textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} className="font-bengali min-h-[140px]" /></Field>
              <Field label="Recipients"><Select value={f.recipients} onChange={(e) => setF({ ...f, recipients: e.target.value as "allOwners" | "workspaces" })}><option value="allOwners">All workspace owners</option><option value="workspaces">Owners of selected workspaces</option></Select></Field>
              {f.recipients === "workspaces" ? <div className="max-h-40 space-y-1 overflow-y-auto rounded-sm border border-border p-2 text-sm scrollbar-thin">{workspaces.data?.rows.map((w) => <label key={w.id} className="flex items-center gap-2"><input type="checkbox" checked={f.workspaceIds.includes(w.id)} onChange={(e) => setF({ ...f, workspaceIds: e.target.checked ? [...f.workspaceIds, w.id] : f.workspaceIds.filter((x) => x !== w.id) })} />{w.name}</label>)}</div> : null}
              <Field label="Schedule (optional)"><Input type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} /></Field>
              <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={doPreview}><Eye className="h-4 w-4" /> Preview</Button>{f.scheduledAt ? <Button loading={busy} onClick={() => send(false)}>Schedule</Button> : <Button loading={busy} onClick={() => send(true)} disabled={!f.subject || !f.message}><Send className="h-4 w-4" /> Send now</Button>}</div>
              <div className="flex gap-2 border-t border-border pt-3"><Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Send a test to…" type="email" /><Button variant="outline" disabled={!testTo} onClick={async () => { try { const r = await api.post<{ delivery: { status: string; lastError: string | null } }>("/api/v1/platform/email/test", { to: testTo, templateKey: f.templateKey, vars: { subject: f.subject, message: f.message } }); r.delivery.status === "FAILED" ? toast.error("Not sent", r.delivery.lastError ?? "") : toast.success("Test email queued"); } catch (err) { toast.error("Failed", err instanceof ApiError ? err.message : undefined); } }}>Test</Button></div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Preview" description={recipientPreview ? `${recipientPreview.recipients} recipients · e.g. ${recipientPreview.sample.slice(0, 3).map((s) => s.email).join(", ")}` : undefined} />
            {preview ? <div className="overflow-hidden rounded-sm border border-border"><div className="border-b border-border bg-surface-2 px-3 py-2 text-[13px]"><strong>Subject:</strong> {preview.subject}</div><iframe title="preview" srcDoc={preview.html} className="h-[520px] w-full bg-white" /></div> : <p className="text-sm text-text-3">Click Preview to render the email with the current branding.</p>}
          </Card>
        </div>
      ) : null}
      {tab === "deliveries" ? (
        <div className="space-y-3">
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40"><option value="">All</option>{["QUEUED", "SENDING", "SENT", "FAILED", "SUPPRESSED"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</Select>
          {deliveries.loading && !deliveries.data ? <LoadingBlock /> : <><Table><thead><tr><Th>To</Th><Th>Template</Th><Th>Status</Th><Th>Provider</Th><Th>Attempts</Th><Th>When</Th><Th></Th></tr></thead><tbody>{deliveries.data?.rows.map((d) => <tr key={d.id}><Td>{d.toEmail}<div className="text-[12px] text-text-3">{d.subject}</div></Td><Td><code className="text-[12px]">{d.templateKey}</code> <Badge tone="outline">{d.locale}</Badge></Td><Td><Badge tone={d.status === "SENT" ? "success" : d.status === "FAILED" ? "danger" : d.status === "SUPPRESSED" ? "neutral" : "warning"}>{d.status.toLowerCase()}</Badge>{d.lastError ? <div className="max-w-xs truncate text-[11px] text-danger" title={d.lastError}>{d.lastError}</div> : null}</Td><Td className="text-text-2">{d.provider ?? "—"}</Td><Td>{d.attempts}</Td><Td className="text-text-3">{d.sentAt ? `sent ${timeAgo(d.sentAt)}` : `queued ${timeAgo(d.scheduledAt)}`}</Td><Td>{d.status === "FAILED" ? <Button size="sm" variant="ghost" onClick={() => api.post("/api/v1/platform/email/retry", { deliveryId: d.id }).then(() => { toast.success("Retry queued"); deliveries.refresh(); }).catch((e) => toast.error("Cannot retry", e.message))}><RotateCcw className="h-4 w-4" /></Button> : null}</Td></tr>)}</tbody></Table><Pagination page={page} pageSize={deliveries.data?.pageSize ?? 50} total={deliveries.data?.total ?? 0} onPage={setPage} /></>}
        </div>
      ) : null}
      {tab === "campaigns" ? <Table><thead><tr><Th>Name</Th><Th>Template</Th><Th>Status</Th><Th>Recipients</Th><Th>Scheduled</Th><Th>Sent</Th></tr></thead><tbody>{campaigns.data?.campaigns.map((c) => <tr key={c.id}><Td className="font-medium">{c.name}</Td><Td><code className="text-[12px]">{c.templateKey}</code></Td><Td><Badge tone={c.status === "SENT" ? "success" : c.status === "SCHEDULED" ? "primary" : "neutral"}>{c.status.toLowerCase()}</Badge></Td><Td>{c.recipientCount}</Td><Td className="text-text-2">{formatDate(c.scheduledAt, true)}</Td><Td className="text-text-2">{formatDate(c.sentAt, true)}</Td></tr>)}{!campaigns.data?.campaigns.length ? <tr><Td colSpan={6} className="py-8 text-center text-text-3">No campaigns yet</Td></tr> : null}</tbody></Table> : null}
      {tab === "templates" ? (
        <div className="space-y-3">
          <Alert tone="info">Variables like {"{{name}}"}, {"{{workspaceName}}"}, {"{{appName}}"}, {"{{supportEmail}}"} and template-specific ones (e.g. {"{{invoiceNumber}}"}) are substituted at send time.</Alert>
          {!templates.data ? <LoadingBlock /> : <Table><thead><tr><Th>Key</Th><Th>Locale</Th><Th>Category</Th><Th>Subject</Th><Th>Active</Th><Th></Th></tr></thead><tbody>{templates.data.templates.map((t) => <tr key={t.id}><Td><code className="text-[12px]">{t.key}</code></Td><Td><Badge tone="outline">{t.locale}</Badge></Td><Td>{t.category}</Td><Td className={t.locale === "bn" ? "font-bengali" : ""}>{t.subject}</Td><Td>{t.isActive ? <Badge tone="success">yes</Badge> : <Badge tone="danger">no</Badge>}</Td><Td><Button size="sm" variant="ghost" onClick={() => setEditTpl(t)}>Edit</Button></Td></tr>)}</tbody></Table>}
        </div>
      ) : null}
      <Dialog open={Boolean(editTpl)} onClose={() => setEditTpl(null)} title={`Edit ${editTpl?.key} (${editTpl?.locale})`} size="lg" footer={<><Button variant="outline" onClick={() => setEditTpl(null)}>Cancel</Button><Button loading={busy} onClick={async () => { setBusy(true); try { await api.put("/api/v1/platform/email/templates", { key: editTpl!.key, locale: editTpl!.locale, subject: editTpl!.subject, body: editTpl!.body, ctaLabel: editTpl!.ctaLabel, isActive: editTpl!.isActive }); toast.success("Template saved"); setEditTpl(null); templates.refresh(); } catch (err) { toast.error("Failed", err instanceof ApiError ? err.message : undefined); } finally { setBusy(false); } }}>Save</Button></>}>
        {editTpl ? <div className="space-y-3"><Field label="Subject"><Input value={editTpl.subject} onChange={(e) => setEditTpl({ ...editTpl, subject: e.target.value })} className={editTpl.locale === "bn" ? "font-bengali" : ""} /></Field><Field label="Body"><Textarea value={editTpl.body} onChange={(e) => setEditTpl({ ...editTpl, body: e.target.value })} className={`min-h-[220px] ${editTpl.locale === "bn" ? "font-bengali" : ""}`} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="CTA label"><Input value={editTpl.ctaLabel ?? ""} onChange={(e) => setEditTpl({ ...editTpl, ctaLabel: e.target.value })} /></Field><Field label="Active"><Select value={editTpl.isActive ? "1" : "0"} onChange={(e) => setEditTpl({ ...editTpl, isActive: e.target.value === "1" })}><option value="1">Yes</option><option value="0">No (fallback to built-in)</option></Select></Field></div></div> : null}
      </Dialog>
      {!templates.data?.templates.length && tab === "templates" ? <div className="flex items-center gap-2 text-sm text-text-3"><Mail className="h-4 w-4" /> Run the seed to load default templates.</div> : null}
    </div>
  );
}
