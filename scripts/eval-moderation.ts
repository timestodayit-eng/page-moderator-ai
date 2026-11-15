/**
 * Runs the representative Bengali / Banglish / English dataset through the live classifier of a workspace
 * and prints precision / recall per category, hide false-positive rate and complaint preservation.
 *
 *   WORKSPACE=coastal-manpower npm run eval:moderation
 *
 * Uses the workspace's active moderation agent (or defaults) and real AI credentials from .env.
 * Enable automatic hiding for a category only when its precision here is acceptable.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../src/server/db";
import { classifyComment, computeSignals } from "../src/server/moderation/classifier";
import { computeMetrics } from "../src/server/agents/evaluation";
import { loadActiveAgent } from "../src/server/agents/service";

async function main() {
  const slug = process.env.WORKSPACE;
  if (!slug) throw new Error("WORKSPACE=<slug> is required");
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { slug } });
  const page = await prisma.connectedPage.findFirst({ where: { workspaceId: ws.id } });
  const agent = await loadActiveAgent(ws.id, null, "MODERATION");
  const dataset = JSON.parse(readFileSync(new URL("../tests/fixtures/moderation-dataset.json", import.meta.url), "utf8")) as { text: string; category: string; expectedDecision: string }[];
  const details = [];
  for (const ex of dataset) {
    const signals = await computeSignals({ pageId: page?.id ?? "eval", fbPageId: page?.fbPageId ?? "eval", message: ex.text, createdTime: new Date() });
    const { classification } = await classifyComment({ workspaceId: ws.id, pageId: page?.id ?? "eval", message: ex.text, signals, agent, businessName: ws.name, purpose: "EVAL" });
    const correct = classification.category === ex.category;
    details.push({ expected: ex.category, predicted: classification.category, expectedDecision: ex.expectedDecision, predictedAction: classification.recommended_action, correct });
    console.log(`${correct ? "✓" : "✗"} ${ex.category.padEnd(16)} → ${classification.category.padEnd(16)} ${classification.recommended_action.padEnd(6)} ${(classification.confidence * 100).toFixed(0)}%  ${ex.text.slice(0, 60)}`);
  }
  const m = computeMetrics(details);
  console.log("\nAccuracy:", (m.accuracy * 100).toFixed(1) + "%");
  console.log("Hide false-positive rate:", (m.hide.falsePositiveRate * 100).toFixed(1) + "%", "· hide recall:", (m.hide.recall * 100).toFixed(1) + "%");
  console.log("Complaints/negative preserved:", (m.complaintPreserved * 100).toFixed(1) + "%");
  console.table(Object.fromEntries(Object.entries(m.perCategory).map(([k, v]) => [k, { precision: +(v.precision * 100).toFixed(0), recall: +(v.recall * 100).toFixed(0), support: v.support }])));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
