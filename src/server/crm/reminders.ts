import { prisma } from "../db";

/** Creates in-app notifications for follow-up tasks due within the next hour (once per task). */
export async function sendFollowUpReminders() {
  const soon = new Date(Date.now() + 3_600_000);
  const tasks = await prisma.followUpTask.findMany({ where: { completedAt: null, reminderSentAt: null, dueAt: { lte: soon } }, include: { lead: { include: { contact: true, workspace: { select: { slug: true } } } } }, take: 200 });
  for (const t of tasks) {
    await prisma.notification.create({ data: { workspaceId: t.workspaceId, userId: t.assignedToId, type: "FOLLOW_UP_DUE", title: t.title, body: t.lead ? `${t.lead.contact.name} — due ${t.dueAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : "", link: t.lead ? `/app/${t.lead.workspace.slug}/crm/${t.leadId}` : null } });
    await prisma.followUpTask.update({ where: { id: t.id }, data: { reminderSentAt: new Date() } });
  }
  return { reminded: tasks.length };
}
