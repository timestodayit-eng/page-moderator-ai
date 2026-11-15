"use client";
import { use, useState } from "react";
import Link from "next/link";
import { Phone, MessageSquare, StickyNote, Check } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, KeyValue, LoadingBlock, PageHeader, Select, Textarea, useToast } from "@/components/ui";
import { useWorkspace } from "@/components/app/workspace-context";
import { useApi } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/utils";
import { STAGES } from "../page";

type Detail = { id: string; title: string; status: string; priority: string; source: string; tags: string[]; followUpAt: string | null; notes: string | null; valueCents: number | null; lostReason: string | null; createdAt: string; updatedAt: string; contact: { id: string; name: string; phone: string | null; email: string | null; fbPsid: string | null; conversations: { id: string; status: string; lastMessageAt: string; page: { name: string } }[] }; assignedTo: { id: string; name: string } | null; activities: { id: string; type: string; body: string; actorId: string | null; createdAt: string; meta: Record<string, unknown> }[]; tasks: { id: string; title: string; dueAt: string; completedAt: string | null }[]; actors: Record<string, string> };

export default function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { workspace, can } = useWorkspace();
  const toast = useToast();
  const d = useApi<Detail>(`/api/v1/leads/${id}`);
  const members = useApi<{ members: { user: { id: string; name: string } }[] }>(can("team.manage") ? "/api/v1/team/members" : null);
  const [note, setNote] = useState("");
  const [noteType, setNoteType] = useState<"NOTE" | "CALL" | "MESSAGE">("NOTE");
  const [followUp, setFollowUp] = useState("");
  const patch = async (p: Record<string, unknown>, ok = "Saved") => {
    try {
      await api.patch(`/api/v1/leads/${id}`, p);
      toast.success(ok);
      d.refresh();
    } catch (err) {
      toast.error("Update failed", err instanceof ApiError ? err.message : undefined);
    }
  };
  if (d.loading && !d.data) return <LoadingBlock rows={5} />;
  if (!d.data) return <Alert tone="danger">{d.error}</Alert>;
  const l = d.data;
  return (
    <div className="space-y-6">
      <PageHeader crumbs={["CRM & Leads"]} title={l.title} description={`${l.contact.name} · created ${formatDate(l.createdAt)} · source ${l.source.toLowerCase()}`} actions={<Select value={l.status} onChange={(e) => patch({ status: e.target.value, ...(e.target.value === "LOST" ? { lostReason: prompt("Reason for losing this lead?") ?? "" } : {}) }, "Stage updated")} className="w-44">{STAGES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Add activity" />
            <div className="flex flex-wrap gap-2">{([["NOTE", StickyNote, "Note"], ["CALL", Phone, "Call"], ["MESSAGE", MessageSquare, "Message"]] as const).map(([k, Icon, label]) => <Button key={k} size="sm" variant={noteType === k ? "soft" : "outline"} onClick={() => setNoteType(k)}><Icon className="h-4 w-4" /> {label}</Button>)}</div>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="font-bengali mt-3" placeholder={noteType === "CALL" ? "Call summary…" : "Write a note…"} />
            <div className="mt-2 flex justify-end"><Button size="sm" disabled={!note.trim()} onClick={async () => { await api.post(`/api/v1/leads/${id}/notes`, { body: note, type: noteType }); setNote(""); d.refresh(); }}>Add</Button></div>
          </Card>
          <Card>
            <CardHeader title="History" />
            <ul className="space-y-3">
              {l.activities.map((a) => (
                <li key={a.id} className="flex gap-3 text-sm">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  <div><div className="flex flex-wrap items-center gap-2"><Badge tone="outline">{a.type.replace("_", " ").toLowerCase()}</Badge><span className="text-[12px] text-text-3">{a.actorId ? l.actors[a.actorId] ?? "Team" : "System"} · {timeAgo(a.createdAt)}</span></div>{a.body ? <p className="mt-1 whitespace-pre-wrap font-bengali text-text">{a.body}</p> : null}</div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Contact" />
            <KeyValue items={[{ k: "Name", v: l.contact.name }, { k: "Phone", v: l.contact.phone ? <a href={`tel:${l.contact.phone}`} className="text-primary">{l.contact.phone}</a> : "—" }, { k: "Email", v: l.contact.email ?? "—" }, { k: "Messenger", v: l.contact.fbPsid ? "Linked" : "—" }]} />
            {l.contact.conversations.length ? <div className="mt-3 space-y-1 text-[13px]">{l.contact.conversations.map((c) => <Link key={c.id} href={`/app/${workspace.slug}/inbox`} className="block text-primary">Conversation on {c.page.name} · {c.status.toLowerCase()} · {timeAgo(c.lastMessageAt)}</Link>)}</div> : null}
          </Card>
          <Card>
            <CardHeader title="Details" />
            <div className="space-y-3">
              <Field label="Priority"><Select value={l.priority} onChange={(e) => patch({ priority: e.target.value })}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></Select></Field>
              {members.data ? <Field label="Assigned to"><Select value={l.assignedTo?.id ?? ""} onChange={(e) => patch({ assignedToId: e.target.value || null })}><option value="">Unassigned</option>{members.data.members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name}</option>)}</Select></Field> : <KeyValue items={[{ k: "Assigned", v: l.assignedTo?.name ?? "—" }]} />}
              <Field label="Next follow-up"><div className="flex gap-2"><Input type="datetime-local" value={followUp} onChange={(e) => setFollowUp(e.target.value)} /><Button variant="outline" disabled={!followUp} onClick={() => patch({ followUpAt: new Date(followUp).toISOString() }, "Follow-up scheduled")}>Set</Button></div>{l.followUpAt ? <p className="mt-1 text-[12px] text-text-3">Current: {formatDate(l.followUpAt, true)}</p> : null}</Field>
              <Field label="Tags"><Input defaultValue={l.tags.join(", ")} onBlur={(e) => patch({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} /></Field>
              <Field label="Notes"><Textarea defaultValue={l.notes ?? ""} onBlur={(e) => e.target.value !== (l.notes ?? "") && patch({ notes: e.target.value })} className="font-bengali" /></Field>
            </div>
          </Card>
          <Card>
            <CardHeader title="Tasks" />
            <ul className="space-y-2 text-sm">{l.tasks.map((t) => <li key={t.id} className="flex items-center justify-between gap-2"><span className={t.completedAt ? "text-text-3 line-through" : new Date(t.dueAt) < new Date() ? "text-danger" : "text-text"}>{t.title}<span className="block text-[11px] text-text-3">{formatDate(t.dueAt, true)}</span></span>{!t.completedAt ? <Button size="sm" variant="ghost" onClick={async () => { await api.post(`/api/v1/tasks/${t.id}`); d.refresh(); }}><Check className="h-4 w-4" /></Button> : null}</li>)}{!l.tasks.length ? <li className="text-text-3">No tasks.</li> : null}</ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
