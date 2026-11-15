import { NextResponse } from "next/server";
import { api } from "@/server/http";
import { listLeads, toCsv } from "@/server/crm/service";
import { audit } from "@/server/audit";

export const GET = api({ permission: "crm.export" }, async ({ req, ws, ip }) => {
  const sp = req.nextUrl.searchParams;
  const { rows } = await listLeads(ws!, { status: sp.get("status") ?? undefined, assigned: sp.get("assigned") ?? undefined, skip: 0, take: 5000 });
  const csv = toCsv(rows.map((r) => ({ id: r.id, title: r.title, status: r.status, priority: r.priority, source: r.source, contact: r.contact.name, phone: r.contact.phone, email: r.contact.email, assignedTo: r.assignedTo?.name ?? "", followUpAt: r.followUpAt, tags: r.tags.join("|"), createdAt: r.createdAt, updatedAt: r.updatedAt })), ["id", "title", "status", "priority", "source", "contact", "phone", "email", "assignedTo", "followUpAt", "tags", "createdAt", "updatedAt"]);
  await audit({ workspaceId: ws!.workspace.id, actorUserId: ws!.user.id, action: "leads.exported", ip, meta: { count: rows.length } });
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"` } });
});
