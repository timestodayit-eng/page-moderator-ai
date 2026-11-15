"use client";
import { useState } from "react";
import { Plus, Users } from "lucide-react";
import { Badge, Button, Dialog, EmptyState, Field, Input, LoadingBlock, PageHeader, Pagination, SearchInput, Table, Td, Textarea, Th, useToast } from "@/components/ui";
import { useApi, useDebounced } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/utils";

type Contact = { id: string; name: string; phone: string | null; email: string | null; tags: string[]; notes: string | null; source: string; fbPsid: string | null; updatedAt: string; _count: { leads: number; conversations: number } };

export default function CustomersPage() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Partial<Contact> | null>(null);
  const q = useDebounced(search);
  const list = useApi<{ rows: Contact[]; total: number; pageSize: number }>(`/api/v1/contacts?page=${page}${q ? `&search=${encodeURIComponent(q)}` : ""}`);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await api.post("/api/v1/contacts", { id: editing?.id, name: editing?.name, phone: editing?.phone || null, email: editing?.email || null, tags: editing?.tags ?? [], notes: editing?.notes || null });
      toast.success("Customer saved");
      setEditing(null);
      list.refresh();
    } catch (err) {
      toast.error("Could not save", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-5">
      <PageHeader title="Customers" description="Everyone who messaged, commented or was added manually. Personal data is stored securely and used only for authorised follow-up." actions={<Button onClick={() => setEditing({ name: "", tags: [] })}><Plus className="h-4 w-4" /> Add customer</Button>} />
      <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name, phone or email…" className="w-full sm:w-80" />
      {list.loading && !list.data ? <LoadingBlock /> : !list.data?.rows.length ? <EmptyState icon={<Users className="h-6 w-6" />} title="No customers yet" /> : (
        <>
          <Table>
            <thead><tr><Th>Name</Th><Th>Phone</Th><Th>Email</Th><Th>Source</Th><Th>Leads</Th><Th>Chats</Th><Th>Tags</Th><Th>Updated</Th></tr></thead>
            <tbody>{list.data.rows.map((c) => <tr key={c.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => setEditing(c)}><Td className="font-medium">{c.name}</Td><Td className="text-text-2">{c.phone ?? "—"}</Td><Td className="text-text-2">{c.email ?? "—"}</Td><Td><Badge tone="outline">{c.source.toLowerCase()}</Badge></Td><Td>{c._count.leads}</Td><Td>{c._count.conversations}</Td><Td><div className="flex flex-wrap gap-1">{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div></Td><Td className="text-text-3">{timeAgo(c.updatedAt)}</Td></tr>)}</tbody>
          </Table>
          <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
        </>
      )}
      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? "Edit customer" : "Add customer"} size="md" footer={<><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} loading={saving} disabled={!editing?.name}>Save</Button></>}>
        {editing ? <div className="space-y-4">
          <Field label="Name" required><Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Phone"><Input value={editing.phone ?? ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field><Field label="Email"><Input type="email" value={editing.email ?? ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field></div>
          <Field label="Tags" hint="Comma separated"><Input value={(editing.tags ?? []).join(", ")} onChange={(e) => setEditing({ ...editing, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} /></Field>
          <Field label="Notes"><Textarea value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} className="font-bengali" /></Field>
        </div> : null}
      </Dialog>
    </div>
  );
}
