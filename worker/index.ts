/**
 * Background worker: outbox dispatcher, BullMQ processors, scheduled maintenance, heartbeat.
 * Runs as its own process (Docker service `worker`). ESM bundle built by esbuild (see package.json build:worker).
 */
import "dotenv/config";
import { Worker, type Processor } from "bullmq";
import { env } from "@/server/env";
import { log } from "@/server/log";
import { prisma } from "@/server/db";
import { bullConnection, closeRedis } from "@/server/queue/redis";
import { QUEUE_NAMES, closeQueues, queue, type QueueName } from "@/server/queue/queues";
import { dispatchOutbox } from "./outbox";
import { emailJob } from "./jobs/email";
import { metaEventJob } from "./jobs/meta-events";
import { moderationJob } from "./jobs/moderation";
import { outboundJob } from "./jobs/outbound";
import { aiJob } from "./jobs/ai";
import { billingJob } from "./jobs/billing";
import { maintenanceJob, scheduleMaintenance } from "./jobs/maintenance";

const e = env();
const processors: Record<QueueName, Processor> = {
  email: emailJob as Processor,
  "meta-events": metaEventJob as Processor,
  moderation: moderationJob as Processor,
  outbound: outboundJob as Processor,
  ai: aiJob as Processor,
  billing: billingJob as Processor,
  maintenance: maintenanceJob as Processor,
};

const workers: Worker[] = [];
let stopping = false;

async function heartbeat() {
  const counts: Record<string, Record<string, number> | string> = {};
  for (const name of QUEUE_NAMES) {
    try {
      counts[name] = await queue(name).getJobCounts("waiting", "active", "failed", "delayed");
    } catch {
      counts[name] = "unavailable";
    }
  }
  const value = { at: new Date().toISOString(), pid: process.pid, queues: counts };
  await prisma.platformSetting
    .upsert({ where: { key: "worker.heartbeat" }, update: { value }, create: { key: "worker.heartbeat", value } })
    .catch((err) => log.warn("heartbeat failed", { err }));
}

async function main() {
  log.info("worker starting", { concurrency: e.WORKER_CONCURRENCY, node: process.version });
  await prisma.$queryRaw`SELECT 1`;
  for (const name of QUEUE_NAMES) {
    const w = new Worker(name, processors[name], { connection: bullConnection(), concurrency: name === "outbound" ? 2 : e.WORKER_CONCURRENCY });
    w.on("failed", (job, err) => log.error("job failed", { queue: name, job: job?.name, id: job?.id, attempts: job?.attemptsMade, err: err.message }));
    w.on("error", (err) => log.error("worker error", { queue: name, err: err.message }));
    workers.push(w);
  }
  await scheduleMaintenance();

  const outboxTimer = setInterval(() => {
    if (!stopping) dispatchOutbox().catch((err) => log.error("outbox tick failed", { err }));
  }, 2000);
  const hbTimer = setInterval(heartbeat, 30_000);
  await heartbeat();
  log.info("worker ready", { queues: QUEUE_NAMES });

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("worker shutting down", { signal });
    clearInterval(outboxTimer);
    clearInterval(hbTimer);
    await Promise.allSettled(workers.map((w) => w.close()));
    await closeQueues();
    await closeRedis();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("worker failed to start", { err });
  process.exit(1);
});
