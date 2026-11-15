import type { Job } from "bullmq";
import { runEvaluation } from "@/server/agents/evaluation";
import { ingestKnowledgeFile } from "@/server/agents/ingest";

export async function aiJob(job: Job<Record<string, string>>) {
  switch (job.name) {
    case "ai.evaluate":
      return runEvaluation(job.data.evaluationId);
    case "ai.ingest-knowledge":
      return ingestKnowledgeFile(job.data.sourceId);
    default:
      return { ignored: job.name };
  }
}
