import type { Job } from "bullmq";
import { executeAction } from "@/server/actions/outbound";

export async function outboundJob(job: Job<{ actionId: string }>) {
  return executeAction(job.data.actionId, `w-${process.pid}-${job.id}`);
}
