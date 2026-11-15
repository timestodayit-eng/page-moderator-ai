import { prisma } from "../db";

/** Flip SCHEDULED campaigns whose time has come to SENT (their deliveries were queued with scheduledAt). */
export async function sendCampaigns() {
  const due = await prisma.emailCampaign.findMany({ where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } } });
  for (const c of due) await prisma.emailCampaign.update({ where: { id: c.id }, data: { status: "SENT", sentAt: new Date() } });
  // Scheduled deliveries are picked up by the outbox dispatcher via availableAt.
  return { released: due.length };
}
