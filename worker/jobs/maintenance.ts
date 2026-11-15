import type { Job } from "bullmq";
import { prisma } from "@/server/db";
import { log } from "@/server/log";
import { queue } from "@/server/queue/queues";
import { runBillingCycle } from "@/server/billing/lifecycle";
import { reconcileStaleActions } from "@/server/actions/outbound";
import { checkPageHealth } from "@/server/meta/health";
import { sendFollowUpReminders } from "@/server/crm/reminders";
import { sendCampaigns } from "@/server/email/campaigns";

export async function scheduleMaintenance() {
  const q = queue("maintenance");
  const jobs: [string, string][] = [
    ["maintenance.retention", "0 3 * * *"],
    ["maintenance.billing-cycle", "15 * * * *"],
    ["maintenance.reconcile-actions", "*/5 * * * *"],
    ["maintenance.page-health", "0 */6 * * *"],
    ["maintenance.followup-reminders", "*/15 * * * *"],
    ["maintenance.campaigns", "* * * * *"],
    ["maintenance.webhook-replay", "*/10 * * * *"],
  ];
  for (const [name, pattern] of jobs) {
    await q.upsertJobScheduler(name, { pattern }, { name, data: {} });
  }
}

export async function maintenanceJob(job: Job) {
  switch (job.name) {
    case "maintenance.retention":
      return applyRetention();
    case "maintenance.billing-cycle":
      return runBillingCycle();
    case "maintenance.reconcile-actions":
      return reconcileStaleActions();
    case "maintenance.page-health":
      return checkPageHealth();
    case "maintenance.followup-reminders":
      return sendFollowUpReminders();
    case "maintenance.campaigns":
      return sendCampaigns();
    case "maintenance.webhook-replay":
      return replayFailedWebhooks();
    default:
      log.warn("unknown maintenance job", { name: job.name });
  }
}

async function applyRetention() {
  const setting = await prisma.platformSetting.findUnique({ where: { key: "retention" } });
  const r = (setting?.value as { commentsDays?: number; messagesDays?: number; auditDays?: number; webhookEventsDays?: number }) ?? {};
  const cutoff = (days: number) => new Date(Date.now() - days * 86_400_000);
  const results: Record<string, number> = {};
  results.webhookEvents = (await prisma.webhookEvent.deleteMany({ where: { receivedAt: { lt: cutoff(r.webhookEventsDays ?? 30) }, status: { in: ["PROCESSED", "IGNORED"] } } })).count;
  results.outbox = (await prisma.webhookOutbox.deleteMany({ where: { status: "DISPATCHED", dispatchedAt: { lt: cutoff(7) } } })).count;
  results.sessions = (await prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff(1) } }, { revokedAt: { lt: cutoff(30) } }] } })).count;
  results.tokens = (await prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: cutoff(7) } } })).count;
  results.oauthStates = (await prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count;
  results.emailVars = (await prisma.emailDelivery.updateMany({ where: { varsEnc: { not: null }, createdAt: { lt: cutoff(14) } }, data: { varsEnc: null } })).count;
  if (r.auditDays) results.audit = (await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff(r.auditDays) } } })).count;
  if (r.commentsDays) results.comments = (await prisma.comment.deleteMany({ where: { receivedAt: { lt: cutoff(r.commentsDays) }, isHidden: false, decisions: { none: { reviewStatus: "PENDING" } } } })).count;
  if (r.messagesDays) results.messages = (await prisma.message.deleteMany({ where: { createdAt: { lt: cutoff(r.messagesDays) } } })).count;
  log.info("retention applied", results);
  return results;
}

async function replayFailedWebhooks() {
  // Re-queue webhook events that failed fewer than 10 times and are older than 2 minutes.
  const events = await prisma.webhookEvent.findMany({ where: { status: "FAILED", attempts: { lt: 10 }, receivedAt: { lt: new Date(Date.now() - 120_000) } }, take: 200, select: { id: true } });
  for (const ev of events) {
    await prisma.webhookEvent.update({ where: { id: ev.id }, data: { status: "QUEUED" } });
    await queue("meta-events").add("meta.event", { eventId: ev.id }, { jobId: `evt:${ev.id}:${Date.now()}` });
  }
  return { replayed: events.length };
}
