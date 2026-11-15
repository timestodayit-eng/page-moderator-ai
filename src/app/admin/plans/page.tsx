"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge, Button, Card, Checkbox, Dialog, Field, Input, LoadingBlock, PageHeader, Textarea, useToast } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/utils";

type Plan = { id: string; key: string; name: string; description: string; priceMonthlyCents: number; priceYearlyCents: number; currency: string; trialDays: number; limits: Record<string, number>; features: string[]; isPublic: boolean; isActive: boolean; sortOrder: number; _count: { subscriptions: number } };
const LIMITS = ["pages", "users", "agents", "commentsPerMonth", "aiRequestsPerMonth", "aiBudgetMicroUsd", "autoRepliesPerMonth", "storageMb"];
const empty: Omit<Plan, "id" | "_count"> = { key: "", name: "", description: "", priceMonthlyCents: 0, priceYearlyCents: 0, currency: "USD", trialDays: 14, limits: Object.fromEntries(LIMITS.map((l) => [l, 0])), features: [], isPublic: true, isActive: true, sortOrder: 10 };

export default function PlansPage() {
  const toast = useToast();
  const d = useApi<{ plans: Plan[] }>("/api/v1/platform/plans");
  const [editing, setEditing] = useState<(Omit<Plan, "_count" | "id"> & { id?: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      await api.post("/api/v1/platform/plans", { ...editing, limits: Object.fromEntries(Object.entries(editing.limits).map(([k, v]) => [k, Number(v)])) });
      toast.success("Plan saved");
      setEditing(null);
      d.refresh();
    } catch (err) {
      toast.error("Could not save plan", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-5">
      <PageHeader title="Subscription Plans" description="Pricing, trial length, allowances and entitlements. Changes apply to new periods; existing overrides stay." actions={<Button onClick={() => setEditing({ ...empty })}><Plus className="h-4 w-4" /> New plan</Button>} />
      {!d.data ? <LoadingBlock /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{d.data.plans.map((p) => (
          <Card key={p.id} className="flex flex-col">
            <div className="flex items-start justify-between"><div><div className="text-[15px] font-semibold text-text">{p.name}</div><div className="text-[12px] text-text-3">{p.key} · sort {p.sortOrder}</div></div><div className="flex gap-1">{!p.isActive ? <Badge tone="danger">inactive</Badge> : null}{!p.isPublic ? <Badge tone="warning">hidden</Badge> : null}</div></div>
            <div className="mt-3 text-2xl font-semibold text-text">{p.priceMonthlyCents ? formatMoney(p.priceMonthlyCents, p.currency) : "Custom"}<span className="text-sm font-normal text-text-3">/mo</span></div>
            <div className="text-[12px] text-text-3">{p.priceYearlyCents ? `${formatMoney(p.priceYearlyCents, p.currency)}/yr · ` : ""}{p.trialDays}-day trial · {p._count.subscriptions} subscribers</div>
            <ul className="mt-3 space-y-0.5 text-[12px] text-text-2">{LIMITS.map((l) => <li key={l} className="flex justify-between"><span>{l}</span><span className="font-medium text-text">{l === "aiBudgetMicroUsd" ? `$${(p.limits[l] / 1e6).toFixed(0)}` : p.limits[l]?.toLocaleString()}</span></li>)}</ul>
            <Button size="sm" variant="outline" className="mt-4" onClick={() => setEditing({ ...p })}>Edit plan</Button>
          </Card>
        ))}</div>
      )}
      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${editing.name}` : "New plan"} size="lg" footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button loading={saving} onClick={save}>Save plan</Button></>}>
        {editing ? <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3"><Field label="Key" hint="lowercase, used in URLs"><Input value={editing.key} onChange={(e) => setEditing({ ...editing, key: e.target.value })} disabled={Boolean(editing.id)} /></Field><Field label="Name"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field><Field label="Sort order"><Input type="number" value={editing.sortOrder} onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })} /></Field></div>
          <Field label="Description"><Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-3"><Field label="Monthly price (cents)"><Input type="number" value={editing.priceMonthlyCents} onChange={(e) => setEditing({ ...editing, priceMonthlyCents: Number(e.target.value) })} /></Field><Field label="Yearly price (cents)"><Input type="number" value={editing.priceYearlyCents} onChange={(e) => setEditing({ ...editing, priceYearlyCents: Number(e.target.value) })} /></Field><Field label="Trial days"><Input type="number" value={editing.trialDays} onChange={(e) => setEditing({ ...editing, trialDays: Number(e.target.value) })} /></Field></div>
          <div><div className="mb-2 text-[13px] font-medium text-text">Allowances</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{LIMITS.map((l) => <Field key={l} label={l === "aiBudgetMicroUsd" ? "AI budget (µUSD)" : l}><Input type="number" value={editing.limits[l] ?? 0} onChange={(e) => setEditing({ ...editing, limits: { ...editing.limits, [l]: Number(e.target.value) } })} /></Field>)}</div></div>
          <Field label="Features (one per line)"><Textarea value={editing.features.join("\n")} onChange={(e) => setEditing({ ...editing, features: e.target.value.split("\n").map((f) => f.trim()).filter(Boolean) })} /></Field>
          <div className="flex gap-6"><Checkbox checked={editing.isPublic} onChange={(v) => setEditing({ ...editing, isPublic: v })} label="Public (shown on pricing page)" /><Checkbox checked={editing.isActive} onChange={(v) => setEditing({ ...editing, isActive: v })} label="Active (can be assigned)" /></div>
        </div> : null}
      </Dialog>
    </div>
  );
}
