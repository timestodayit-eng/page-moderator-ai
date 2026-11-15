import type { Job } from "bullmq";
import { processBillingWebhookEvent } from "@/server/billing/providers";

export async function billingJob(job: Job<{ eventId: string }>) {
  if (job.name === "billing.webhook") return processBillingWebhookEvent(job.data.eventId);
  return { ignored: job.name };
}
