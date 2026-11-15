import { Queue, type JobsOptions } from "bullmq";
import { bullConnection } from "./redis";

export const QUEUE_NAMES = ["email", "meta-events", "moderation", "outbound", "ai", "billing", "maintenance"] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

const queues = new Map<QueueName, Queue>();

export function queue(name: QueueName) {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: bullConnection(),
      defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 3000 }, removeOnComplete: { age: 3600, count: 2000 }, removeOnFail: { age: 7 * 86400 } },
    });
    queues.set(name, q);
  }
  return q;
}

/** Topic → queue routing for the transactional outbox. */
export function routeTopic(topic: string): { queue: QueueName; jobName: string } {
  const [ns] = topic.split(".");
  switch (ns) {
    case "email":
      return { queue: "email", jobName: topic };
    case "meta":
      return { queue: "meta-events", jobName: topic };
    case "moderation":
      return { queue: "moderation", jobName: topic };
    case "outbound":
      return { queue: "outbound", jobName: topic };
    case "ai":
      return { queue: "ai", jobName: topic };
    case "billing":
      return { queue: "billing", jobName: topic };
    default:
      return { queue: "maintenance", jobName: topic };
  }
}

export async function enqueueDirect(topic: string, payload: Record<string, unknown>, opts?: JobsOptions) {
  const { queue: qn, jobName } = routeTopic(topic);
  return queue(qn).add(jobName, payload, opts);
}

export async function closeQueues() {
  await Promise.allSettled([...queues.values()].map((q) => q.close()));
  queues.clear();
}
