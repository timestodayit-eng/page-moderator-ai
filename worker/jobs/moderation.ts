import type { Job } from "bullmq";
import { processComment } from "@/server/moderation/engine";

export async function moderationJob(job: Job<{ commentId: string }>) {
  return processComment(job.data.commentId);
}
