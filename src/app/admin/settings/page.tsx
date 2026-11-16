"use client";
import { useEffect, useState } from "react";
import { Button, Card, CardHeader, Checkbox, Field, Input, LoadingBlock, PageHeader, Select, Switch, Tabs, useToast } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";

type Settings = Record<string, Record<string, unknown>>;
const HIDE_CATS = ["SPAM", "SCAM", "SUSPICIOUS_LINK", "REPEATED_PROMO", "DEFAMATION", "ABUSE", "HARASSMENT", "HATE_SPEECH", "PII_EXPOSURE", "HIGH_RISK", "NEGATIVE", "COMPLAINT"];

export default function PlatformSettings() {
  const toast = useToast();
  const d = useApi<{ settings: Settings }>("/api/v1/platform/settings");
  const [tab, setTab] = useState<"branding" | "ai" | "moderation" | "registration" | "security" | "retention" | "features" | "notifications">("branding");
  const [s, setS] = useState<Settings>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (d.data) setS(d.data.settings); }, [d.data]);
  const v = (k: string) => s[tab]?.[k];
  const set = (k: string, val: unknown) => setS((x) => ({ ...x, [tab]: { ...(x[tab] ?? {}), [k]: val } }));
  async function save() {
    setSaving(true);
    try {
      await api.put("/api/v1/platform/settings", { key: tab, value: s[tab] ?? {} });
      toast.success("Settings saved");
      d.refresh();
    } catch (err) {
      toast.error("Could not save", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }
  if (!d.data) return <LoadingBlock rows={5} />;
  const num = (k: string, label: string, hint?: string) => <Field label={label} hint={hint}><Input type="number" value={Number(v(k) ?? 0)} onChange={(e) => set(k, Number(e.target.value))} /></Field>;
  const str = (k: string, label: string, hint?: string, placeholder?: string) => <Field label={label} hint={hint}><Input value={String(v(k) ?? "")} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} /></Field>;
  const bool = (k: string, label: string, desc?: string) => <Switch checked={Boolean(v(k))} onChange={(val) => set(k, val)} label={label} description={desc} />;
  return (
    <div className="space-y-5">
      <PageHeader title="Platform Settings" description="Global configuration. Every change is recorded in the audit log." actions={<Button onClick={save} loading={saving}>Save {tab}</Button>} />
      <Tabs value={tab} onChange={setTab} items={[{ value: "branding", label: "Branding" }, { value: "ai", label: "AI" }, { value: "moderation", label: "Moderation safety" }, { value: "registration", label: "Registration" }, { value: "security", label: "Security" }, { value: "retention", label: "Data retention" }, { value: "features", label: "Feature flags" }, { value: "notifications", label: "Notifications" }]} />
      <Card>
        {tab === "branding" ? <div className="grid gap-4 sm:grid-cols-2">{str("appName", "Platform name")}{str("brandColor", "Brand colour", "Hex, used in emails", "#2563EB")}{str("logoUrl", "Logo URL (emails)", "Absolute https URL to a PNG")}{str("supportEmail", "Support email")}{str("footer", "Email footer line")}</div> : null}
        {tab === "ai" ? <div className="grid gap-4 sm:grid-cols-2"><Field label="Default AI provider"><Select value={String(v("defaultProvider") ?? "openai")} onChange={(e) => set("defaultProvider", e.target.value)}><option value="openai">OpenAI</option><option value="gemini">Google Gemini</option><option value="deepseek">DeepSeek</option></Select></Field>{num("monthlyPlatformBudgetMicroUsd", "Monthly platform AI budget (µUSD)", "1,000,000 = $1. Platform-managed requests stop when reached.")}{num("warnAtPercent", "Warn customers at % of their allowance")}</div> : null}
        {tab === "moderation" ? <div className="space-y-4"><CardHeader title="Global safety floor" description="Applies on top of every Page's configuration. Businesses cannot exceed these." /><div className="grid gap-4 sm:grid-cols-2">{num("globalMaxAutoHidesPerPagePerHour", "Max automatic hides per Page per hour")}{num("minAutoHideConfidence", "Minimum confidence for automatic hiding (0–1)")}</div><Field label="Categories eligible for automatic hiding"><div className="flex flex-wrap gap-3">{HIDE_CATS.map((c) => <Checkbox key={c} checked={((v("autoHideAllowedCategories") as string[]) ?? []).includes(c)} onChange={(on) => { const cur = (v("autoHideAllowedCategories") as string[]) ?? []; set("autoHideAllowedCategories", on ? [...cur, c] : cur.filter((x) => x !== c)); }} label={c.replace(/_/g, " ")} />)}</div></Field></div> : null}
        {tab === "registration" ? <div className="space-y-4">{bool("enabled", "Allow self-service registration")}{bool("requireApproval", "New workspaces require Super Admin approval", "Workspaces start as PENDING with billing-only access")}<Field label="Allowed email domains" hint="Comma separated; empty = any"><Input value={((v("allowedDomains") as string[]) ?? []).join(", ")} onChange={(e) => set("allowedDomains", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} /></Field></div> : null}
        {tab === "security" ? <div className="grid gap-4 sm:grid-cols-2">{num("sessionTtlHours", "Session lifetime (hours)")}{num("maxFailedLogins", "Failed logins before temporary lock")}<div className="sm:col-span-2">{bool("requireEmailVerification", "Require email verification before connecting Pages")}</div></div> : null}
        {tab === "retention" ? <div className="grid gap-4 sm:grid-cols-2">{num("commentsDays", "Keep comments (days)", "Hidden comments and pending reviews are never purged")}{num("messagesDays", "Keep Messenger messages (days)")}{num("auditDays", "Keep audit logs (days)")}{num("webhookEventsDays", "Keep processed webhook events (days)")}</div> : null}
        {tab === "features" ? <div className="space-y-3">{bool("messenger", "Messenger inbox")}{bool("crm", "CRM & leads")}{bool("billing", "Self-service billing")}{bool("byok", "Bring Your Own Key")}</div> : null}
        {tab === "notifications" ? <div className="space-y-3">{bool("ownersOnModerationIncidents", "Email owners on high-risk moderation incidents")}{bool("usageWarnings", "Email usage limit warnings")}</div> : null}
      </Card>
    </div>
  );
}
