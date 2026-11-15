"use client";
import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, UserPlus, StickyNote, Hand, Tag, Inbox as InboxIcon, Bookmark } from "lucide-react";
import { Alert, Avatar, Badge, Button, Dialog, EmptyState, Field, Input, LoadingBlock, SearchInput, Select, Tabs, Textarea, useToast } from "@/components/ui";
import { useWorkspace } from "@/components/app/workspace-context";
import { useApi, useDebounced, usePolling } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { cn, formatDate, timeAgo } from "@/lib/utils";

type Conv = { id: string; status: string; priority: string; unreadCount: number; lastMessageAt: string; lastPreview: string | null; tags: string[]; aiMode: string; contact: { id: string; name: string; phone: string | null; tags: string[] }; page: { id: string; name: string }; assignedTo: { id: string; name: string } | null };
type Msg = { id: string; direction: "IN" | "OUT"; text: string; senderType: string; sentById: string | null; status: string; error: string | null; createdAt: string };
type Detail = Conv & { messages: Msg[]; authors: Record<string, string>; notes: { id: string; body: string; authorId: string; createdAt: string }[]; contact: Conv["contact"] & { email: string | null; notes: string | null; leads: { id: string; title: string; status: string }[] }; messagingWindowOpen: boolean; replyLocked: string | null; humanTakeoverAt: string | null };
const STATUSES = ["NEW", "OPEN", "ASSIGNED", "PENDING", "RESOLVED", "CLOSED"];

export default function InboxPage() {
  const { workspace, user, can } = useWorkspace();
  const toast = useToast();
  const [status, setStatus] = useState<string>("");
  const [assigned, setAssigned] = useState("");
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useApi<{ rows: Conv[]; counts: Record<string, number>; total: number }>(`/api/v1/inbox/conversations?pageSize=50${status ? `&status=${status}` : ""}${assigned ? `&assigned=${assigned}` : ""}${q ? `&search=${encodeURIComponent(q)}` : ""}`);
  usePolling(() => list.refresh(), 15000);
  const detail = useApi<Detail>(selected ? `/api/v1/inbox/conversations/${selected}` : null);
  usePolling(() => detail.refresh(), 8000, Boolean(selected));
  const members = useApi<{ members: { id: string; user: { id: string; name: string } }[] }>(can("team.manage") ? "/api/v1/team/members" : null);
  const saved = useApi<{ replies: { id: string; title: string; body: string }[] }>("/api/v1/inbox/saved-replies");
  const counts = list.data?.counts ?? {};
  const openCount = (counts.NEW ?? 0) + (counts.OPEN ?? 0) + (counts.ASSIGNED ?? 0) + (counts.PENDING ?? 0);

  return (
    <div className="-m-4 flex h-[calc(100vh-64px)] overflow-hidden sm:-m-6 lg:-m-8">
      <aside className={cn("flex w-full flex-col border-r border-border bg-surface md:w-[360px]", selected && "hidden md:flex")}>
        <div className="space-y-3 border-b border-border p-4">
          <div className="flex items-center justify-between"><h1 className="text-[17px] font-semibold text-text">Inbox</h1><Badge tone="primary">{openCount} open</Badge></div>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, phone, message…" />
          <div className="flex gap-2"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()} ({counts[s] ?? 0})</option>)}</Select><Select value={assigned} onChange={(e) => setAssigned(e.target.value)}><option value="">Anyone</option><option value="me">Assigned to me</option><option value="unassigned">Unassigned</option></Select></div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {list.loading && !list.data ? <div className="p-4"><LoadingBlock /></div> : !list.data?.rows.length ? <EmptyState icon={<InboxIcon className="h-5 w-5" />} title="No conversations" description="Messages arrive here when customers write to a connected Page with messaging permission." className="m-4" /> : list.data.rows.map((c) => (
            <button key={c.id} onClick={() => setSelected(c.id)} className={cn("flex w-full gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-surface-2", selected === c.id && "bg-primary-soft/40")}>
              <Avatar name={c.contact.name} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2"><span className={cn("truncate text-sm text-text", c.unreadCount && "font-semibold")}>{c.contact.name}</span><span className="shrink-0 text-[11px] text-text-3">{timeAgo(c.lastMessageAt)}</span></div>
                <div className="truncate font-bengali text-[13px] text-text-2">{c.lastPreview ?? "—"}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1"><Badge tone={c.status === "NEW" ? "primary" : c.status === "RESOLVED" || c.status === "CLOSED" ? "neutral" : c.status === "PENDING" ? "warning" : "success"} className="text-[10px]">{c.status.toLowerCase()}</Badge>{c.priority !== "NORMAL" ? <Badge tone={c.priority === "URGENT" ? "danger" : "warning"} className="text-[10px]">{c.priority.toLowerCase()}</Badge> : null}{c.assignedTo ? <span className="text-[11px] text-text-3">· {c.assignedTo.name}</span> : null}{c.unreadCount ? <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] font-semibold text-white">{c.unreadCount}</span> : null}</div>
              </div>
            </button>
          ))}
        </div>
      </aside>
      <section className={cn("flex min-w-0 flex-1 flex-col bg-bg", !selected && "hidden md:flex")}>
        {!selected ? <div className="flex flex-1 items-center justify-center text-sm text-text-3">Select a conversation</div> : detail.loading && !detail.data ? <div className="p-6"><LoadingBlock /></div> : detail.data ? <Thread key={detail.data.id} conv={detail.data} userId={user.id} canReply={can("inbox.reply")} canAutomate={can("pages.automation")} canCrm={can("crm.access")} members={members.data?.members.map((m) => m.user) ?? []} savedReplies={saved.data?.replies ?? []} onBack={() => setSelected(null)} onChanged={() => { detail.refresh(); list.refresh(); }} toast={toast} wsSlug={workspace.slug} /> : <Alert tone="danger" className="m-6">{detail.error}</Alert>}
      </section>
    </div>
  );
}

function Thread({ conv, userId, canReply, canAutomate, canCrm, members, savedReplies, onBack, onChanged, toast, wsSlug }: { conv: Detail; userId: string; canReply: boolean; canAutomate: boolean; canCrm: boolean; members: { id: string; name: string }[]; savedReplies: { id: string; title: string; body: string }[]; onBack: () => void; onChanged: () => void; toast: ReturnType<typeof useToast>; wsSlug: string }) {
  const [text, setText] = useState("");
  const [tag, setTag] = useState("");
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<{ reply: string; confidence: number; escalate: boolean; reason: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tags, setTags] = useState(conv.tags.join(", "));
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [conv.messages.length]);
  const patch = async (p: Record<string, unknown>) => {
    try {
      await api.patch(`/api/v1/inbox/conversations/${conv.id}`, p);
      onChanged();
    } catch (err) {
      toast.error("Update failed", err instanceof ApiError ? err.message : undefined);
    }
  };
  async function send() {
    if (!text.trim()) return;
    setSending(true);
    try {
      await api.post(`/api/v1/inbox/conversations/${conv.id}/messages`, { text, tag: tag || undefined });
      setText("");
      setSuggestion(null);
      onChanged();
    } catch (err) {
      toast.error("Could not send", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSending(false);
    }
  }
  async function suggest() {
    setSuggesting(true);
    try {
      setSuggestion(await api.post(`/api/v1/inbox/conversations/${conv.id}/suggest`));
    } catch (err) {
      toast.error("No suggestion", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSuggesting(false);
    }
  }
  const lockedByOther = conv.replyLocked && conv.replyLocked !== userId;
  return (
    <>
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-3">
        <button onClick={onBack} className="text-[13px] text-primary md:hidden">← Back</button>
        <Avatar name={conv.contact.name} size="sm" />
        <div className="min-w-0"><div className="truncate text-sm font-semibold text-text">{conv.contact.name}</div><div className="text-[11px] text-text-3">{conv.page.name}{conv.contact.phone ? ` · ${conv.contact.phone}` : ""}</div></div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={conv.status} onChange={(e) => patch({ status: e.target.value })} className="h-8 w-32 text-[13px]">{STATUSES.map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}</Select>
          <Select value={conv.priority} onChange={(e) => patch({ priority: e.target.value })} className="h-8 w-28 text-[13px]"><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></Select>
          {members.length ? <Select value={conv.assignedTo?.id ?? ""} onChange={(e) => patch({ assignedToId: e.target.value || null })} className="h-8 w-36 text-[13px]"><option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select> : conv.assignedTo ? <Badge>{conv.assignedTo.name}</Badge> : <Button size="sm" variant="outline" onClick={() => patch({ assignedToId: userId })}>Assign to me</Button>}
          <Select value={conv.aiMode} onChange={(e) => patch({ aiMode: e.target.value })} className="h-8 w-32 text-[13px]"><option value="OFF">AI off</option><option value="SUGGEST">AI suggests</option><option value="AUTO" disabled={!canAutomate}>AI auto-reply</option></Select>
          <Button size="sm" variant="ghost" onClick={() => setTagsOpen(true)}><Tag className="h-4 w-4" /></Button>
          {canCrm ? <Button size="sm" variant="ghost" onClick={() => api.post("/api/v1/leads/from-source", { conversationId: conv.id }).then(() => { toast.success("Lead created"); onChanged(); }).catch((e) => toast.error("Failed", e.message))}><UserPlus className="h-4 w-4" /></Button> : null}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 scrollbar-thin">
            {conv.messages.map((m) => (
              <div key={m.id} className={cn("flex", m.direction === "OUT" ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[78%] rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed font-bengali shadow-soft", m.direction === "OUT" ? "rounded-br-md bg-primary text-white" : "rounded-bl-md border border-border bg-surface text-text")}>
                  <div className="whitespace-pre-wrap">{m.text || <em className="opacity-70">[attachment]</em>}</div>
                  <div className={cn("mt-1 text-[10.5px]", m.direction === "OUT" ? "text-white/70" : "text-text-3")}>{m.direction === "OUT" ? `${m.senderType === "AI" ? "AI" : conv.authors[m.sentById ?? ""] ?? "Page"} · ` : ""}{formatDate(m.createdAt, true)}{m.direction === "OUT" ? ` · ${m.status.toLowerCase()}` : ""}{m.error ? <span className="block text-danger">{m.error}</span> : null}</div>
                </div>
              </div>
            ))}
            <div ref={bottom} />
          </div>
          <div className="border-t border-border bg-surface p-3">
            {conv.humanTakeoverAt ? null : conv.aiMode === "AUTO" ? <Alert tone="info" className="mb-2 py-2">AI auto-reply is on for this conversation. Sending a message takes over and switches the AI to suggest mode.</Alert> : null}
            {lockedByOther ? <Alert tone="warning" className="mb-2 py-2">{conv.authors[conv.replyLocked!] ?? "A teammate"} is replying right now.</Alert> : null}
            {!conv.messagingWindowOpen ? <Alert tone="warning" className="mb-2 py-2">The 24-hour messaging window has closed. Choose a Meta message tag to send.</Alert> : null}
            {suggestion ? <div className="mb-2 rounded-sm border border-primary/30 bg-primary-soft/40 p-3 text-[13px]"><div className="flex items-center gap-2 text-primary"><Sparkles className="h-4 w-4" /> AI suggestion · {Math.round(suggestion.confidence * 100)}%{suggestion.escalate ? <Badge tone="warning">suggests human follow-up</Badge> : null}</div><p className="mt-1 font-bengali text-text">{suggestion.reply}</p><div className="mt-2 flex gap-2"><Button size="sm" onClick={() => { setText(suggestion.reply); setSuggestion(null); }}>Use</Button><Button size="sm" variant="ghost" onClick={() => setSuggestion(null)}>Dismiss</Button></div></div> : null}
            {canReply ? (
              <div className="space-y-2">
                <Textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(); }} placeholder="Write a reply… (Ctrl+Enter to send)" className="font-bengali min-h-[72px]" />
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={suggest} loading={suggesting}><Sparkles className="h-4 w-4" /> Suggest</Button>
                  {savedReplies.length ? <Select className="h-8 w-44 text-[13px]" value="" onChange={(e) => { const r = savedReplies.find((x) => x.id === e.target.value); if (r) setText((t) => (t ? `${t}\n${r.body}` : r.body)); }}><option value="">Saved replies…</option>{savedReplies.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</Select> : null}
                  <Button size="sm" variant="ghost" onClick={() => setNote("")}><StickyNote className="h-4 w-4" /> Note</Button>
                  {!conv.humanTakeoverAt && conv.aiMode === "AUTO" ? <Button size="sm" variant="ghost" onClick={() => api.post(`/api/v1/inbox/conversations/${conv.id}/takeover`).then(onChanged)}><Hand className="h-4 w-4" /> Take over</Button> : null}
                  {!conv.messagingWindowOpen ? <Select value={tag} onChange={(e) => setTag(e.target.value)} className="h-8 w-52 text-[13px]"><option value="">Select message tag…</option><option value="HUMAN_AGENT">HUMAN_AGENT (7 days)</option><option value="CONFIRMED_EVENT_UPDATE">CONFIRMED_EVENT_UPDATE</option><option value="POST_PURCHASE_UPDATE">POST_PURCHASE_UPDATE</option><option value="ACCOUNT_UPDATE">ACCOUNT_UPDATE</option></Select> : null}
                  <Button size="sm" className="ml-auto" onClick={send} loading={sending} disabled={!text.trim() || Boolean(lockedByOther) || (!conv.messagingWindowOpen && !tag)}><Send className="h-4 w-4" /> Send</Button>
                </div>
              </div>
            ) : <p className="text-[13px] text-text-3">You can view this conversation but do not have permission to reply.</p>}
          </div>
        </div>
        <aside className="hidden w-[280px] shrink-0 overflow-y-auto border-l border-border bg-surface p-4 xl:block scrollbar-thin">
          <div className="text-[12px] font-semibold uppercase tracking-wider text-text-3">Customer</div>
          <div className="mt-2 text-sm font-medium text-text">{conv.contact.name}</div>
          <div className="text-[13px] text-text-2">{conv.contact.phone ?? "No phone"}{conv.contact.email ? ` · ${conv.contact.email}` : ""}</div>
          {conv.tags.length ? <div className="mt-2 flex flex-wrap gap-1">{conv.tags.map((t) => <Badge key={t} tone="outline">{t}</Badge>)}</div> : null}
          <div className="mt-5 text-[12px] font-semibold uppercase tracking-wider text-text-3">Leads</div>
          {conv.contact.leads.length ? <ul className="mt-2 space-y-1 text-[13px]">{conv.contact.leads.map((l) => <li key={l.id}><a href={`/app/${wsSlug}/crm/${l.id}`} className="text-primary hover:underline">{l.title}</a> <span className="text-text-3">· {l.status.toLowerCase()}</span></li>)}</ul> : <p className="mt-1 text-[13px] text-text-3">No leads yet.</p>}
          <div className="mt-5 flex items-center justify-between"><span className="text-[12px] font-semibold uppercase tracking-wider text-text-3">Internal notes</span><button onClick={() => setNote("")} className="text-[12px] text-primary">+ Add</button></div>
          <ul className="mt-2 space-y-2">{conv.notes.map((n) => <li key={n.id} className="rounded-sm bg-warning-soft/60 p-2.5 text-[13px] text-text"><div className="font-bengali">{n.body}</div><div className="mt-1 text-[11px] text-text-3">{conv.authors[n.authorId] ?? "Team"} · {timeAgo(n.createdAt)}</div></li>)}{!conv.notes.length ? <li className="text-[13px] text-text-3">No notes.</li> : null}</ul>
          <div className="mt-5 text-[12px] font-semibold uppercase tracking-wider text-text-3">Saved replies</div>
          <ul className="mt-2 space-y-1 text-[13px]">{savedReplies.slice(0, 6).map((r) => <li key={r.id}><button onClick={() => setText(r.body)} className="flex items-center gap-1.5 text-text-2 hover:text-primary"><Bookmark className="h-3 w-3" />{r.title}</button></li>)}{!savedReplies.length ? <li className="text-text-3">None — add in Settings.</li> : null}</ul>
        </aside>
      </div>
      <Dialog open={note !== null} onClose={() => setNote(null)} title="Internal note" description="Visible only to your team." size="sm" footer={<><Button variant="outline" onClick={() => setNote(null)}>Cancel</Button><Button onClick={async () => { await api.post(`/api/v1/inbox/conversations/${conv.id}/notes`, { body: note }); setNote(null); onChanged(); }} disabled={!note?.trim()}>Save note</Button></>}><Textarea value={note ?? ""} onChange={(e) => setNote(e.target.value)} className="font-bengali" /></Dialog>
      <Dialog open={tagsOpen} onClose={() => setTagsOpen(false)} title="Conversation tags" size="sm" footer={<><Button variant="outline" onClick={() => setTagsOpen(false)}>Cancel</Button><Button onClick={async () => { await patch({ tags: tags.split(",").map((t) => t.trim()).filter(Boolean) }); setTagsOpen(false); }}>Save</Button></>}><Field label="Tags" hint="Comma separated"><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="saudi, salary, urgent" /></Field></Dialog>
    </>
  );
}
