import { prisma } from "@/server/db";
import { log } from "@/server/log";
import { enqueueDirect } from "@/server/queue/queues";

/**
 * Outbox dispatcher: claims PENDING rows (SKIP LOCKED so several workers can run) and pushes them to BullMQ.
 * Job IDs equal outbox IDs, so a crash between "enqueued" and "marked dispatched" cannot duplicate work.
 */
export async function dispatchOutbox(batch = 100) {
  const rows = await prisma.$queryRaw<{ id: string; topic: string; payload: Record<string, unknown>; attempts: number }[]>`
    UPDATE "WebhookOutbox" SET "attempts" = "attempts" + 1
    WHERE "id" IN (
      SELECT "id" FROM "WebhookOutbox" WHERE "status" = 'PENDING' AND "availableAt" <= NOW() ORDER BY "createdAt" LIMIT ${batch} FOR UPDATE SKIP LOCKED
    ) RETURNING "id", "topic", "payload", "attempts"`;
  let ok = 0;
  for (const row of rows) {
    try {
      await enqueueDirect(row.topic, { ...row.payload, outboxId: row.id }, { jobId: `ob:${row.id}` });
      await prisma.webhookOutbox.update({ where: { id: row.id }, data: { status: "DISPATCHED", dispatchedAt: new Date() } });
      ok++;
    } catch (err) {
      const giveUp = row.attempts >= 20;
      await prisma.webhookOutbox.update({ where: { id: row.id }, data: { status: giveUp ? "FAILED" : "PENDING", lastError: String(err).slice(0, 500), availableAt: new Date(Date.now() + Math.min(60_000, 2000 * row.attempts)) } });
      log.warn("outbox dispatch failed", { id: row.id, topic: row.topic, err: String(err) });
    }
  }
  return { claimed: rows.length, dispatched: ok };
}
