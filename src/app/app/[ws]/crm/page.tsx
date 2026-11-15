"use client";
import { useState } from "react";
import Link from "next/link";
import { Plus, Download, LayoutGrid, List, CalendarClock } from "lucide-react";
import { Avatar, Badge, Button, Card, Dialog, EmptyState, Field, Input, LoadingBlock, PageHeader, Pagination, SearchInput, Select, Table, Td, Textarea, Th, useToast } from "@/components/ui";
import { useWorkspace } from "@/components/app/workspace-context";
import { useApi, useDebounced } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { cn, formatDate, timeAgo } from "@/lib/utils";

type Lead = { id: string; title: string; status: string; priority: string; source: string; tags: string[]; followUpAt: string | null; updatedAt: string; createdAt: string; valueCents: number | null; contact: { id: string; name: string; phone: string | null; email: string | null }; assignedTo: { id: string; name: string } | null };
export const STAGES = [["NEW", "New lead"], ["CONTACTED", "Contacted"], ["QUALIFIED", "Qualified"], ["FOLLOW_UP", "Follow-up"], ["CONVERTED", "Converted"], ["LOST", "Lost"]] as const;
const PRIORITY_TONE: Record<string, "neutral" | "warning" | "danger"> = { LOW: "neutral", NORMAL: "neutral", HIGH: "warning", URGENT: "danger" };

export default function CrmPage() {
  const { workspace, user, can } = useWorkspace();
  const toast = useToast();
  const base = `/app/${workspace.slug}`;
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [search, setSearch] = useState("");
  const [assigned, setAssigned] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search);
  const list = useApi<{ rows: Lead[]; total: number; pageSize: number; pipeline: { status: string; count: number }[] }>(`/api/v1/leads?page=${page}&pageSize=${view === "kanban" ? 100 : 50}${q ? `&search=${encodeURIComponent(q)}` : ""}${assigned ? `&assigned=${assigned}` : ""}${status && view === "table" ? `&status=${status}` : ""}`);
  const tasks = useApi<{ tasks: { id: string; title: string; dueAt: string; lead: { id: string; title: string; contact: { name: string } } | null }[] }>("/api/v1/tasks");
  const members = useApi<{ members: { user: { id: string; name: string } }[] }>(can("team.manage") ? "/api/v1/team/members" : null);
  const move = async (lead: Lead, to: string) => {
    try {
      await api.patch(`/api/v1/leads/${lead.id}`, { status: to });
      list.refresh();
    } catch (err) {
      toast.error("Could not move lead", err instanceof ApiError ? err.message : undefined);
    }
  };
  const rows = list.data?.rows ?? [];
  const overdue = tasks.data?.tasks.filter((t) => new Date(t.dueAt) <= new Date()) ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="CRM & Leads" description="Pipeline: New → Contacted → Qualified → Follow-up → Converted / Lost." actions={<>
        {can("crm.export") ? <a href={`/api/v1/leads/export`}><Button variant="outline"><Download className="h-4 w-4" /> Export CSV</Button></a> : null}
        <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New lead</Button>
      </>} />
      {overdue.length ? <Card className="flex flex-wrap items-center gap-3 border-warning/40 bg-warning-soft/40 py-3"><CalendarClock className="h-5 w-5 text-warning" /><span className="text-sm text-text"><strong>{overdue.length}</strong> follow-up{overdue.length > 1 ? "s are" : " is"} due:</span>{overdue.slice(0, 4).map((t) => <Link key={t.id} href={t.lead ? `${base}/crm/${t.lead.id}` : "#"} className="text-[13px] font-medium text-primary">{t.lead?.contact.name ?? t.title}</Link>)}</Card> : null}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-sm bg-surface-2 p-1"><button onClick={() => setView("kanban")} className={cn("rounded-xs p-1.5", view === "kanban" ? "bg-surface shadow-soft text-text" : "text-text-3")} aria-label="Kanban"><LayoutGrid className="h-4 w-4" /></button><button onClick={() => setView("table")} className={cn("rounded-xs p-1.5", view === "table" ? "bg-surface shadow-soft text-text" : "text-text-3")} aria-label="Table"><List className="h-4 w-4" /></button></div>
        <SearchInput value={search} onChange={setSearch} placeholder="Search leads…" className="w-full sm:w-64" />
        <Select value={assigned} onChange={(e) => setAssigned(e.target.value)} className="w-40"><option value="">Everyone</option><option value="me">Mine</option><option value="unassigned">Unassigned</option></Select>
        {view === "table" ? <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40"><option value="">All stages</option>{STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select> : null}
        <div className="ml-auto flex gap-1.5 text-[12px] text-text-2">{list.data?.pipeline.map((p) => <span key={p.status} className="rounded-full bg-surface-2 px-2 py-0.5">{STAGES.find((s) => s[0] === p.status)?.[1]} <strong className="text-text">{p.count}</strong></span>)}</div>
      </div>
      {list.loading && !list.data ? <LoadingBlock rows={4} /> : view === "kanban" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex min-w-[1100px] gap-3">
            {STAGES.map(([key, label]) => {
              const items = rows.filter((r) => r.status === key);
              return (
                <div key={key} className="flex w-[220px] shrink-0 flex-col rounded-card bg-surface-2/70 p-2" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData("lead"); const l = rows.find((r) => r.id === id); if (l && l.status !== key) move(l, key); }}>
                  <div className="flex items-center justify-between px-2 py-1.5 text-[12px] font-semibold uppercase tracking-wider text-text-2">{label}<span className="rounded-full bg-surface px-1.5 text-[11px] text-text-3">{items.length}</span></div>
                  <div className="flex flex-col gap-2">
                    {items.map((l) => (
                      <Link key={l.id} href={`${base}/crm/${l.id}`} draggable onDragStart={(e) => e.dataTransfer.setData("lead", l.id)} className="rounded-sm border border-border bg-surface p-3 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-card">
                        <div className="text-[13px] font-medium text-text">{l.title}</div>
                        <div className="mt-0.5 text-[12px] text-text-2">{l.contact.name}{l.contact.phone ? ` · ${l.contact.phone}` : ""}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-1">{l.priority !== "NORMAL" ? <Badge tone={PRIORITY_TONE[l.priority]} className="text-[10px]">{l.priority.toLowerCase()}</Badge> : null}<Badge tone="outline" className="text-[10px]">{l.source.toLowerCase()}</Badge>{l.followUpAt ? <span className={cn("text-[11px]", new Date(l.followUpAt) < new Date() ? "text-danger" : "text-text-3")}>⏰ {formatDate(l.followUpAt)}</span> : null}</div>
                        {l.assignedTo ? <div className="mt-2 flex items-center gap-1.5 text-[11px] text-text-3"><Avatar name={l.assignedTo.name} size="sm" className="h-5 w-5 text-[9px]" />{l.assignedTo.name}</div> : null}
                      </Link>
                    ))}
                    {!items.length ? <div className="rounded-sm border border-dashed border-border p-3 text-center text-[12px] text-text-3">Drop here</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : !rows.length ? <EmptyState title="No leads" /> : (
        <>
          <Table>
            <thead><tr><Th>Lead</Th><Th>Contact</Th><Th>Stage</Th><Th>Priority</Th><Th>Assigned</Th><Th>Follow-up</Th><Th>Source</Th><Th>Updated</Th></tr></thead>
            <tbody>{rows.map((l) => <tr key={l.id} className="hover:bg-surface-2/60"><Td><Link href={`${base}/crm/${l.id}`} className="font-medium text-text hover:text-primary">{l.title}</Link></Td><Td>{l.contact.name}<div className="text-[12px] text-text-3">{l.contact.phone ?? l.contact.email ?? ""}</div></Td><Td><Select value={l.status} onChange={(e) => move(l, e.target.value)} className="h-8 w-36 text-[13px]">{STAGES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Td><Td><Badge tone={PRIORITY_TONE[l.priority]}>{l.priority.toLowerCase()}</Badge></Td><Td className="text-text-2">{l.assignedTo?.name ?? "—"}</Td><Td className={cn("text-[13px]", l.followUpAt && new Date(l.followUpAt) < new Date() ? "text-danger" : "text-text-2")}>{l.followUpAt ? formatDate(l.followUpAt, true) : "—"}</Td><Td><Badge tone="outline">{l.source.toLowerCase()}</Badge></Td><Td className="text-text-3">{timeAgo(l.updatedAt)}</Td></tr>)}</tbody>
          </Table>
          <Pagination page={page} pageSize={list.data?.pageSize ?? 50} total={list.data?.total ?? 0} onPage={setPage} />
        </>
      )}
      {creating ? <NewLeadDialog members={members.data?.members.map((m) => m.user) ?? [{ id: user.id, name: user.name }]} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); list.refresh(); }} /> : null}
    </div>
  );
}

function NewLeadDialog({ members, onClose, onCreated }: { members: { id: string; name: string }[]; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", phone: "", email: "", title: "", priority: "NORMAL", assignedToId: "", followUpAt: "", notes: "", tags: "" });
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await api.post("/api/v1/leads", { contact: { name: f.name, phone: f.phone || undefined, email: f.email || undefined }, title: f.title || `${f.name} — inquiry`, priority: f.priority, assignedToId: f.assignedToId || null, followUpAt: f.followUpAt ? new Date(f.followUpAt).toISOString() : null, notes: f.notes || undefined, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean), source: "MANUAL" });
      toast.success("Lead created");
      onCreated();
    } catch (err) {
      toast.error("Could not create lead", err instanceof ApiError ? err.message : undefined);
      setSaving(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title="New lead" size="lg" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving} disabled={!f.name}>Create lead</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="01XXXXXXXXX" /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Lead title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Saudi driver visa" /></Field>
        <Field label="Priority"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></Select></Field>
        <Field label="Assign to"><Select value={f.assignedToId} onChange={(e) => setF({ ...f, assignedToId: e.target.value })}><option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
        <Field label="Follow-up"><Input type="datetime-local" value={f.followUpAt} onChange={(e) => setF({ ...f, followUpAt: e.target.value })} /></Field>
        <Field label="Tags" hint="Comma separated"><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="font-bengali" /></Field></div>
      </div>
    </Dialog>
  );
}
