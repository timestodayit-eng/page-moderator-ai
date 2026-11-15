import type { LeadStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "../db";
import { Errors } from "../errors";
import { audit } from "../audit";
import type { WorkspaceContext } from "../rbac/guard";

type Meta = { ip?: string | null };
const PIPELINE: LeadStatus[] = ["NEW", "CONTACTED", "QUALIFIED", "FOLLOW_UP", "CONVERTED", "LOST"];

function leadScope(ctx: WorkspaceContext): Prisma.LeadWhereInput {
  return ctx.permissions.has("crm.all") ? { workspaceId: ctx.workspace.id } : { workspaceId: ctx.workspace.id, OR: [{ assignedToId: ctx.user.id }, { createdById: ctx.user.id }] };
}

export async function listLeads(ctx: WorkspaceContext, q: { status?: string; assigned?: string; source?: string; tag?: string; priority?: string; search?: string; dueBefore?: Date; skip: number; take: number; sort?: string }) {
  const where: Prisma.LeadWhereInput = {
    AND: [
      leadScope(ctx),
      q.status ? { status: q.status as LeadStatus } : {},
      q.assigned === "me" ? { assignedToId: ctx.user.id } : q.assigned === "unassigned" ? { assignedToId: null } : q.assigned ? { assignedToId: q.assigned } : {},
      q.source ? { source: q.source } : {},
      q.tag ? { tags: { has: q.tag } } : {},
      q.priority ? { priority: q.priority } : {},
      q.dueBefore ? { followUpAt: { lte: q.dueBefore } } : {},
      q.search ? { OR: [{ title: { contains: q.search, mode: "insensitive" } }, { contact: { name: { contains: q.search, mode: "insensitive" } } }, { contact: { phone: { contains: q.search } } }] } : {},
    ],
  };
  const orderBy: Prisma.LeadOrderByWithRelationInput = q.sort === "followUp" ? { followUpAt: "asc" } : q.sort === "oldest" ? { createdAt: "asc" } : { updatedAt: "desc" };
  const [total, rows, byStatus] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({ where, skip: q.skip, take: q.take, orderBy, include: { contact: { select: { id: true, name: true, phone: true, email: true, fbPsid: true } }, assignedTo: { select: { id: true, name: true } } } }),
    prisma.lead.groupBy({ by: ["status"], _count: true, where: leadScope(ctx) }),
  ]);
  return { total, rows, pipeline: PIPELINE.map((s) => ({ status: s, count: byStatus.find((b) => b.status === s)?._count ?? 0 })) };
}

export async function createLead(ctx: WorkspaceContext, input: { contactId?: string; contact?: { name: string; phone?: string; email?: string }; title: string; source?: string; priority?: string; tags?: string[]; assignedToId?: string | null; followUpAt?: Date | null; notes?: string; valueCents?: number }, meta: Meta) {
  return prisma.$transaction(async (tx) => {
    let contactId = input.contactId;
    if (!contactId) {
      if (!input.contact?.name) throw Errors.badRequest("Contact name is required");
      const c = await tx.contact.create({ data: { workspaceId: ctx.workspace.id, name: input.contact.name.trim(), phone: input.contact.phone?.trim() || null, email: input.contact.email?.trim().toLowerCase() || null, source: input.source ?? "MANUAL" } });
      contactId = c.id;
    } else {
      const c = await tx.contact.findFirst({ where: { id: contactId, workspaceId: ctx.workspace.id } });
      if (!c) throw Errors.notFound("Contact");
    }
    const lead = await tx.lead.create({ data: { workspaceId: ctx.workspace.id, contactId, title: input.title.trim(), source: input.source ?? "MANUAL", priority: input.priority ?? "NORMAL", tags: input.tags ?? [], assignedToId: input.assignedToId ?? null, followUpAt: input.followUpAt ?? null, notes: input.notes, valueCents: input.valueCents, createdById: ctx.user.id } });
    await tx.leadActivity.create({ data: { workspaceId: ctx.workspace.id, leadId: lead.id, type: "CREATED", actorId: ctx.user.id, body: `Lead created (${lead.source})` } });
    if (input.followUpAt && (input.assignedToId || ctx.user.id)) await tx.followUpTask.create({ data: { workspaceId: ctx.workspace.id, leadId: lead.id, assignedToId: input.assignedToId ?? ctx.user.id, title: `Follow up: ${lead.title}`, dueAt: input.followUpAt } });
    await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "lead.created", targetType: "Lead", targetId: lead.id, ip: meta.ip }, tx);
    return lead;
  });
}

export async function updateLead(ctx: WorkspaceContext, id: string, patch: { title?: string; status?: LeadStatus; priority?: string; tags?: string[]; assignedToId?: string | null; followUpAt?: Date | null; notes?: string; valueCents?: number | null; lostReason?: string }, meta: Meta) {
  const lead = await prisma.lead.findFirst({ where: { AND: [leadScope(ctx), { id }] } });
  if (!lead) throw Errors.notFound("Lead");
  if (patch.assignedToId) {
    const m = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: patch.assignedToId, workspaceId: ctx.workspace.id } } });
    if (!m || m.status !== "ACTIVE") throw Errors.badRequest("Assignee is not an active member");
  }
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id }, data: { ...patch, convertedAt: patch.status === undefined ? undefined : patch.status === "CONVERTED" ? new Date() : null } });
    if (patch.status && patch.status !== lead.status) await tx.leadActivity.create({ data: { workspaceId: ctx.workspace.id, leadId: id, type: "STATUS_CHANGE", actorId: ctx.user.id, body: `${lead.status} → ${patch.status}`, meta: { from: lead.status, to: patch.status, lostReason: patch.lostReason } } });
    if (patch.assignedToId !== undefined && patch.assignedToId !== lead.assignedToId) await tx.leadActivity.create({ data: { workspaceId: ctx.workspace.id, leadId: id, type: "ASSIGNMENT", actorId: ctx.user.id, body: patch.assignedToId ? "Assigned" : "Unassigned", meta: { to: patch.assignedToId } } });
    if (patch.followUpAt) {
      await tx.followUpTask.updateMany({ where: { leadId: id, completedAt: null }, data: { completedAt: new Date() } });
      await tx.followUpTask.create({ data: { workspaceId: ctx.workspace.id, leadId: id, assignedToId: patch.assignedToId ?? lead.assignedToId ?? ctx.user.id, title: `Follow up: ${patch.title ?? lead.title}`, dueAt: patch.followUpAt } });
    }
    await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "lead.updated", targetType: "Lead", targetId: id, ip: meta.ip, meta: { patch } }, tx);
  });
}

export async function leadDetail(ctx: WorkspaceContext, id: string) {
  const lead = await prisma.lead.findFirst({ where: { AND: [leadScope(ctx), { id }] }, include: { contact: { include: { conversations: { select: { id: true, status: true, lastMessageAt: true, page: { select: { name: true } } }, orderBy: { lastMessageAt: "desc" }, take: 5 } } }, assignedTo: { select: { id: true, name: true } }, activities: { orderBy: { createdAt: "desc" }, take: 100 }, tasks: { orderBy: { dueAt: "asc" } } } });
  if (!lead) throw Errors.notFound("Lead");
  const actorIds = [...new Set(lead.activities.map((a) => a.actorId).filter(Boolean))] as string[];
  const actors = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  return { ...lead, actors: Object.fromEntries(actors.map((a) => [a.id, a.name])) };
}

export async function addLeadNote(ctx: WorkspaceContext, id: string, body: string, type: "NOTE" | "CALL" | "MESSAGE" = "NOTE") {
  const lead = await prisma.lead.findFirst({ where: { AND: [leadScope(ctx), { id }] } });
  if (!lead) throw Errors.notFound("Lead");
  return prisma.leadActivity.create({ data: { workspaceId: ctx.workspace.id, leadId: id, type, actorId: ctx.user.id, body: body.trim().slice(0, 4000) } });
}

export async function completeTask(ctx: WorkspaceContext, taskId: string) {
  const t = await prisma.followUpTask.findFirst({ where: { id: taskId, workspaceId: ctx.workspace.id } });
  if (!t) throw Errors.notFound("Task");
  if (t.assignedToId !== ctx.user.id && !ctx.permissions.has("crm.all")) throw Errors.forbidden();
  await prisma.followUpTask.update({ where: { id: taskId }, data: { completedAt: new Date() } });
}

export async function listContacts(ctx: WorkspaceContext, q: { search?: string; tag?: string; skip: number; take: number }) {
  const where: Prisma.ContactWhereInput = { workspaceId: ctx.workspace.id, ...(q.tag ? { tags: { has: q.tag } } : {}), ...(q.search ? { OR: [{ name: { contains: q.search, mode: "insensitive" } }, { phone: { contains: q.search } }, { email: { contains: q.search, mode: "insensitive" } }] } : {}) };
  const [total, rows] = await Promise.all([prisma.contact.count({ where }), prisma.contact.findMany({ where, skip: q.skip, take: q.take, orderBy: { updatedAt: "desc" }, include: { _count: { select: { leads: true, conversations: true } } } })]);
  return { total, rows };
}

export async function upsertContact(ctx: WorkspaceContext, input: { id?: string; name: string; phone?: string | null; email?: string | null; tags?: string[]; notes?: string | null }, meta: Meta) {
  const data = { name: input.name.trim(), phone: input.phone?.trim() || null, email: input.email?.trim().toLowerCase() || null, tags: input.tags ?? [], notes: input.notes ?? null };
  let contact;
  if (input.id) {
    const existing = await prisma.contact.findFirst({ where: { id: input.id, workspaceId: ctx.workspace.id } });
    if (!existing) throw Errors.notFound("Contact");
    contact = await prisma.contact.update({ where: { id: input.id }, data });
  } else contact = await prisma.contact.create({ data: { ...data, workspaceId: ctx.workspace.id } });
  await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: input.id ? "contact.updated" : "contact.created", targetType: "Contact", targetId: contact.id, ip: meta.ip });
  return contact;
}

/** Create a lead from a comment or conversation (one click in the UI). */
export async function leadFromSource(ctx: WorkspaceContext, input: { commentId?: string; conversationId?: string; title?: string }, meta: Meta) {
  if (input.conversationId) {
    const conv = await prisma.conversation.findFirst({ where: { id: input.conversationId, workspaceId: ctx.workspace.id }, include: { contact: true } });
    if (!conv) throw Errors.notFound("Conversation");
    return createLead(ctx, { contactId: conv.contactId, title: input.title ?? `Messenger inquiry — ${conv.contact.name}`, source: "MESSENGER", assignedToId: conv.assignedToId ?? ctx.user.id }, meta);
  }
  if (input.commentId) {
    const c = await prisma.comment.findFirst({ where: { id: input.commentId, workspaceId: ctx.workspace.id } });
    if (!c) throw Errors.notFound("Comment");
    let contact = c.authorFbId ? await prisma.contact.findFirst({ where: { workspaceId: ctx.workspace.id, fbUserId: c.authorFbId } }) : null;
    if (!contact) contact = await prisma.contact.create({ data: { workspaceId: ctx.workspace.id, name: c.authorName ?? "Facebook commenter", fbUserId: c.authorFbId, source: "COMMENT" } });
    return createLead(ctx, { contactId: contact.id, title: input.title ?? `Comment inquiry — ${contact.name}`, source: "COMMENT", notes: c.message.slice(0, 1000), assignedToId: ctx.user.id }, meta);
  }
  throw Errors.badRequest("commentId or conversationId required");
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n");
}
