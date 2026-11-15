import type { Job } from "bullmq";
import { deliverEmail } from "@/server/email/service";

export async function emailJob(job: Job<{ deliveryId: string }>) {
  return deliverEmail(job.data.deliveryId);
}
