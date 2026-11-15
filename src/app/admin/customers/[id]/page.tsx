"use client";
import { use, useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Field, Input, KeyValue, LoadingBlock, PageHeader, Select, Switch, Table, Td, Th, Textarea, useToast } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMicroUsd, formatMoney, formatNumber, timeAgo } from "@/lib/utils";

type Detail = { id: string; slug: string; name: string; type: string; status: string; billingExempt: boolean; emergencyPause: boolean; allowPlatformFallback: boolean; aiCredentialMode: string; servicesEnabled: Record<string, boolean>; createdAt: string; subscription: { id: string; status: string; interval: string; currentPeriodEnd: string; trialEndsAt: string | null; limitOverrides: Record<string, number>; discountPercent: number; plan: { key: string; name: string; limits: Record<string, number> } } | null; memberships: { id: string; status: string; user: { id: string; email: string; name: string; status: string; lastLoginAt: string | null }; role: { key: string; name: string } }[]; pages: { id: string; name: string; fbPageId: string; status: string; moderationMode: string; autoHideEnabled: boolean; connectedAt: string }[]; invoices: { id: string; number: string; status: string; totalCents: number; currency: string; dueAt: string }[]; aiCredentials: { id: string; provider: string; keyLast4: string; status: string }[]; usage: Record<string, number>; recentAudit: { id: string; action: string; createdAt: string; actorType: string }[] };
const LIMIT_KEYS = ["pages", "users", "agents", "commentsPerMonth", "aiRequestsPerMonth", "aiBudgetMicroUsd", "autoRepliesPerMonth", "storageMb"];

export default function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const d = useApi<Detail>(`/api/v1/platform/workspaces/${id}`);
  const plans = useApi<{ plans: { key: string; name: string }[] }>("/api/v1/platform/plans");
  const [statusDlg, setStatusDlg] = useState<"SUSPENDED" | "ACTIVE" | "CLOSED" | null>(null);
  const [reason, setReason] = useState("");
  const [subDlg, setSubDlg] = useState(false);
  const [sub, setSub] = useState({ planKey: "", status: "", extendDays: "", trialExtendDays: "", discountPercent: "", overrides: {} as Record<string, string> });
  const [payDlg, setPayDlg] = useState<Detail["invoices"][number] | null>(null);
  const [pay, setPay] = useState({ amount: "", reference: "", method: "bank" });
  const [supportReason, setSupportReason] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      d.refresh();
    } catch (err) {
      toast.error("Failed", err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };
  if (!d.data) return d.error ? <Alert tone="danger">{d.error}</Alert> : <LoadingBlock rows={6} />;
  const x = d.data;
  return (
    <div className="space-y-6">
      <PageHeader crumbs={["Customers"]} title={x.name} description={`${x.slug} · ${x.type.toLowerCase()} · created ${formatDate(x.createdAt)}`} actions={<>
        {x.status === "ACTIVE" ? <Button variant="danger" onClick={() => setStatusDlg("SUSPENDED")}>Suspend</Button> : <Button onClick={() => setStatusDlg("ACTIVE")}>{x.status === "PENDING" ? "Approve" : "Reactivate"}</Button>}
        <Button variant="outline" onClick={() => { setSub({ planKey: x.subscription?.plan.key ?? "", status: "", extendDays: "", trialExtendDays: "", discountPercent: String(x.subscription?.discountPercent ?? 0), overrides: Object.fromEntries(Object.entries(x.subscription?.limitOverrides ?? {}).map(([k, v]) => [k, String(v)])) }); setSubDlg(true); }}>Subscription</Button>
        <Button variant="outline" onClick={() => run(() => api.post(`/api/v1/platform/email/campaigns`, { name: `Notice to ${x.name}`, templateKey: "platform.notice", recipientFilter: { workspaceIds: [x.id], allOwners: true }, vars: { subject: prompt("Email subject") ?? "Notice", message: prompt("Message") ?? "" }, sendNow: true }), "Email queued to owners")}>Email owners</Button>
      </>} />
      <div className="flex flex-wrap gap-2"><Badge tone={x.status === "ACTIVE" ? "success" : x.status === "SUSPENDED" ? "danger" : "warning"}>{x.status.toLowerCase()}</Badge>{x.billingExempt ? <Badge tone="primary">billing exempt</Badge> : null}{x.emergencyPause ? <Badge tone="danger">emergency pause</Badge> : null}<Badge tone="outline">AI: {x.aiCredentialMode}</Badge>{x.subscription ? <Badge tone="outline">{x.subscription.plan.name} · {x.subscription.status.toLowerCase()} · until {formatDate(x.subscription.currentPeriodEnd)}</Badge> : null}</div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card><CardHeader title="Service usage (this month)" /><KeyValue items={[{ k: "Comments processed", v: formatNumber(x.usage.COMMENTS_PROCESSED ?? 0) }, { k: "AI requests", v: formatNumber(x.usage.AI_REQUEST ?? 0) }, { k: "AI cost", v: formatMicroUsd(x.usage.AI_COST_MICROUSD ?? 0) }, { k: "Auto replies", v: x.usage.AUTO_REPLY ?? 0 }, { k: "Auto hides", v: x.usage.AUTO_HIDE ?? 0 }]} /></Card>
        <Card><CardHeader title="Limits" description="Plan limits with overrides" />{x.subscription ? <KeyValue items={LIMIT_KEYS.map((k) => ({ k, v: x.subscription!.limitOverrides[k] !== undefined ? <span>{formatNumber(x.subscription!.limitOverrides[k])} <Badge tone="primary">override</Badge></span> : formatNumber(x.subscription!.plan.limits[k] ?? 0) }))} /> : <p className="text-sm text-text-3">No subscription</p>}</Card>
        <Card>
          <CardHeader title="Services & controls" />
          <div className="space-y-3">
            {["moderation", "replies", "inbox", "crm"].map((s) => <Switch key={s} checked={x.servicesEnabled[s] !== false} onChange={(v) => run(() => api.patch(`/api/v1/platform/workspaces/${id}`, { servicesEnabled: { [s]: v } }), `${s} ${v ? "activated" : "deactivated"}`)} label={`${s[0].toUpperCase()}${s.slice(1)} service`} />)}
            <Switch checked={x.emergencyPause} onChange={(v) => run(() => api.patch(`/api/v1/platform/workspaces/${id}`, { emergencyPause: v }), v ? "Automation paused" : "Automation resumed")} label="Emergency pause" description="Stops all automated Meta actions" />
            <Switch checked={x.allowPlatformFallback} onChange={(v) => run(() => api.patch(`/api/v1/platform/workspaces/${id}`, { allowPlatformFallback: v }), "Updated")} label="Allow platform AI fallback for BYOK" description="Off = a failing customer key never spends platform credits" />
            <Switch checked={x.billingExempt} onChange={(v) => run(() => api.patch(`/api/v1/platform/workspaces/${id}`, { billingExempt: v }), "Billing exemption updated")} label="Billing exempt (internal business)" />
          </div>
        </Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card padded={false}><div className="p-5 pb-0"><CardHeader title="Members" /></div><Table className="rounded-none border-0 shadow-none"><thead><tr><Th>User</Th><Th>Role</Th><Th>Status</Th><Th>Last login</Th></tr></thead><tbody>{x.memberships.map((m) => <tr key={m.id}><Td><a href={`/admin/users/${m.user.id}`} className="font-medium text-primary">{m.user.name}</a><div className="text-[12px] text-text-3">{m.user.email}</div></Td><Td>{m.role.name}</Td><Td><Badge tone={m.status === "ACTIVE" && m.user.status === "ACTIVE" ? "success" : "danger"}>{m.user.status !== "ACTIVE" ? "suspended account" : m.status.toLowerCase()}</Badge></Td><Td className="text-text-3">{m.user.lastLoginAt ? timeAgo(m.user.lastLoginAt) : "never"}</Td></tr>)}</tbody></Table></Card>
        <Card padded={false}><div className="p-5 pb-0"><CardHeader title="Facebook Pages" /></div><Table className="rounded-none border-0 shadow-none"><thead><tr><Th>Page</Th><Th>Status</Th><Th>Mode</Th><Th>Connected</Th></tr></thead><tbody>{x.pages.map((p) => <tr key={p.id}><Td>{p.name}<div className="text-[12px] text-text-3">{p.fbPageId}</div></Td><Td><Badge tone={p.status === "CONNECTED" ? "success" : p.status === "DISCONNECTED" ? "neutral" : "warning"}>{p.status.toLowerCase()}</Badge></Td><Td>{p.moderationMode.toLowerCase()}{p.autoHideEnabled ? " · auto-hide" : ""}</Td><Td className="text-text-3">{timeAgo(p.connectedAt)}</Td></tr>)}{!x.pages.length ? <tr><Td colSpan={4} className="text-center text-text-3">No Pages</Td></tr> : null}</tbody></Table></Card>
        <Card padded={false}><div className="p-5 pb-0"><CardHeader title="Invoices" /></div><Table className="rounded-none border-0 shadow-none"><thead><tr><Th>Number</Th><Th>Amount</Th><Th>Due</Th><Th>Status</Th><Th></Th></tr></thead><tbody>{x.invoices.map((i) => <tr key={i.id}><Td>{i.number}</Td><Td>{formatMoney(i.totalCents, i.currency)}</Td><Td className="text-text-2">{formatDate(i.dueAt)}</Td><Td><Badge tone={i.status === "PAID" ? "success" : i.status === "OPEN" ? "warning" : "neutral"}>{i.status.toLowerCase()}</Badge></Td><Td>{i.status === "OPEN" ? <Button size="sm" variant="outline" onClick={() => { setPay({ amount: String(i.totalCents / 100), reference: "", method: "bank" }); setPayDlg(i); }}>Record payment</Button> : null}</Td></tr>)}{!x.invoices.length ? <tr><Td colSpan={5} className="text-center text-text-3">No invoices</Td></tr> : null}</tbody></Table></Card>
        <Card>
          <CardHeader title="Support access" description="Request time-boxed access to private Messenger conversations. The workspace owner must approve." />
          <div className="flex gap-2"><Textarea value={supportReason} onChange={(e) => setSupportReason(e.target.value)} placeholder="Reason (ticket reference, what you need to see)" className="min-h-[56px]" /><Button disabled={supportReason.length < 5 || busy} onClick={() => run(() => api.post(`/api/v1/platform/workspaces/${id}/support-access`, { reason: supportReason, scope: "inbox:read" }), "Access requested — owner notified")}>Request</Button></div>
          <CardHeader title="Recent audit" className="mt-6" />
          <ul className="space-y-1 text-[13px]">{x.recentAudit.slice(0, 12).map((a) => <li key={a.id} className="flex justify-between gap-2"><code className="text-[12px] text-text">{a.action}</code><span className="text-text-3">{a.actorType.toLowerCase()} · {timeAgo(a.createdAt)}</span></li>)}</ul>
        </Card>
      </div>
      <Dialog open={Boolean(statusDlg)} onClose={() => setStatusDlg(null)} title={statusDlg === "SUSPENDED" ? "Suspend workspace" : statusDlg === "ACTIVE" ? "Activate workspace" : "Close workspace"} size="sm" footer={<><Button variant="outline" onClick={() => setStatusDlg(null)}>Cancel</Button><Button variant={statusDlg === "SUSPENDED" ? "danger" : "primary"} loading={busy} onClick={async () => { await run(() => api.post(`/api/v1/platform/workspaces/${id}/status`, { status: statusDlg, reason }), "Status updated"); setStatusDlg(null); }}>Confirm</Button></>}>
        {statusDlg === "SUSPENDED" ? <Alert tone="warning" className="mb-3">Suspending cancels pending actions, pauses automation and emails the owners. Members keep read access to billing only.</Alert> : null}
        <Field label="Reason (included in the email)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Dialog>
      <Dialog open={subDlg} onClose={() => setSubDlg(false)} title="Manage subscription" size="lg" footer={<><Button variant="outline" onClick={() => setSubDlg(false)}>Cancel</Button><Button loading={busy} onClick={async () => { const overrides = Object.fromEntries(Object.entries(sub.overrides).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)])); await run(() => api.post(`/api/v1/platform/workspaces/${id}/subscription`, { planKey: sub.planKey || undefined, status: sub.status || undefined, extendDays: sub.extendDays ? Number(sub.extendDays) : undefined, trialExtendDays: sub.trialExtendDays ? Number(sub.trialExtendDays) : undefined, discountPercent: sub.discountPercent !== "" ? Number(sub.discountPercent) : undefined, limitOverrides: overrides }), "Subscription updated"); setSubDlg(false); }}>Apply</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan"><Select value={sub.planKey} onChange={(e) => setSub({ ...sub, planKey: e.target.value })}>{plans.data?.plans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></Field>
          <Field label="Force status"><Select value={sub.status} onChange={(e) => setSub({ ...sub, status: e.target.value })}><option value="">(keep)</option>{["TRIALING", "ACTIVE", "PAST_DUE", "GRACE", "CANCELED", "EXPIRED", "SUSPENDED", "EXEMPT"].map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
          <Field label="Extend period (days)"><Input type="number" value={sub.extendDays} onChange={(e) => setSub({ ...sub, extendDays: e.target.value })} /></Field>
          <Field label="Extend trial (days)"><Input type="number" value={sub.trialExtendDays} onChange={(e) => setSub({ ...sub, trialExtendDays: e.target.value })} /></Field>
          <Field label="Discount %"><Input type="number" min={0} max={100} value={sub.discountPercent} onChange={(e) => setSub({ ...sub, discountPercent: e.target.value })} /></Field>
          <div className="sm:col-span-2"><div className="mb-2 text-[13px] font-medium text-text">Limit overrides (blank = plan default)</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{LIMIT_KEYS.map((k) => <Field key={k} label={k}><Input type="number" value={sub.overrides[k] ?? ""} onChange={(e) => setSub({ ...sub, overrides: { ...sub.overrides, [k]: e.target.value } })} /></Field>)}</div></div>
        </div>
      </Dialog>
      <Dialog open={Boolean(payDlg)} onClose={() => setPayDlg(null)} title={`Record payment for ${payDlg?.number}`} description="Only after you have verified the transfer. This activates the subscription and emails a receipt." size="sm" footer={<><Button variant="outline" onClick={() => setPayDlg(null)}>Cancel</Button><Button loading={busy} disabled={!pay.reference} onClick={async () => { await run(() => api.post(`/api/v1/invoices/${payDlg!.id}/manual-payment`, { amountCents: Math.round(Number(pay.amount) * 100), currency: payDlg!.currency, reference: pay.reference, method: pay.method }), "Payment recorded"); setPayDlg(null); }}>Record</Button></>}>
        <div className="space-y-3"><Field label="Amount"><Input type="number" step="0.01" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field><Field label="Method"><Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option value="bank">Bank transfer</option><option value="bkash">bKash</option><option value="nagad">Nagad</option><option value="cash">Cash</option></Select></Field><Field label="Reference / transaction ID" required><Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field></div>
      </Dialog>
    </div>
  );
}
