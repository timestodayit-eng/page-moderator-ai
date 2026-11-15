import { prisma } from "../db";
import { log } from "../log";
import { classifyComment, computeSignals } from "../moderation/classifier";
import type { Provider } from "../ai/gateway";

/**
 * Evaluate an agent version against the workspace's labelled moderation examples.
 * Produces accuracy, per-category precision/recall, false-positive rate for HIDE decisions.
 * Runs in the worker; each example is one metered AI call (purpose=EVAL).
 */
export async function runEvaluation(evaluationId: string) {
  const ev = await prisma.agentEvaluation.findUnique({ where: { id: evaluationId }, include: { agent: { include: { workspace: true } } } });
  if (!ev || ev.status !== "QUEUED") return { skipped: true };
  await prisma.agentEvaluation.update({ where: { id: evaluationId }, data: { status: "RUNNING", startedAt: new Date() } });
  const version = await prisma.agentVersion.findUnique({ where: { id: ev.agentVersionId } });
  if (!version) {
    await prisma.agentEvaluation.update({ where: { id: evaluationId }, data: { status: "FAILED", error: "version not found" } });
    return { failed: true };
  }
  const examples = await prisma.trainingExample.findMany({ where: { workspaceId: ev.workspaceId, kind: "MODERATION", status: "ACTIVE", category: { not: null }, OR: [{ agentId: ev.agentId }, { agentId: null }] }, take: 200 });
  const details: { exampleId: string; text: string; expected: string; predicted: string; expectedDecision: string | null; predictedAction: string; confidence: number; correct: boolean }[] = [];
  const agent = { id: ev.agentId, versionId: version.id, instructions: version.instructions, provider: version.provider as Provider, model: version.model, temperature: version.temperature, languages: version.languages, tone: version.tone, safetyRules: version.safetyRules, knowledgeSourceIds: version.knowledgeSourceIds };
  const page = await prisma.connectedPage.findFirst({ where: { workspaceId: ev.workspaceId }, select: { id: true, fbPageId: true } });
  let failures = 0;
  for (const ex of examples) {
    try {
      const signals = await computeSignals({ pageId: page?.id ?? "eval", fbPageId: page?.fbPageId ?? "eval", authorFbId: null, message: ex.text, createdTime: new Date() });
      const { classification } = await classifyComment({ workspaceId: ev.workspaceId, pageId: page?.id ?? "eval", message: ex.text, signals, agent, businessName: ev.agent.workspace.name, purpose: "EVAL" });
      const correct = classification.category === ex.category;
      details.push({ exampleId: ex.id, text: ex.text.slice(0, 200), expected: ex.category!, predicted: classification.category, expectedDecision: ex.expectedDecision, predictedAction: classification.recommended_action, confidence: classification.confidence, correct });
    } catch (err) {
      failures++;
      log.warn("evaluation example failed", { evaluationId, exampleId: ex.id, err: String(err) });
      if (failures > 5 && details.length === 0) break; // provider is down / budget exhausted
    }
  }
  const metrics = computeMetrics(details);
  await prisma.agentEvaluation.update({ where: { id: evaluationId }, data: { status: details.length ? "COMPLETED" : "FAILED", completedAt: new Date(), total: details.length, correct: details.filter((d) => d.correct).length, metrics, details, error: details.length ? null : "No examples could be evaluated (check AI configuration / budget)" } });
  return metrics;
}

export function computeMetrics(details: { expected: string; predicted: string; expectedDecision: string | null; predictedAction: string; correct: boolean }[]) {
  const cats = [...new Set(details.flatMap((d) => [d.expected, d.predicted]))];
  const perCategory: Record<string, { precision: number; recall: number; support: number }> = {};
  for (const c of cats) {
    const tp = details.filter((d) => d.predicted === c && d.expected === c).length;
    const fp = details.filter((d) => d.predicted === c && d.expected !== c).length;
    const fn = details.filter((d) => d.predicted !== c && d.expected === c).length;
    perCategory[c] = { precision: tp + fp ? tp / (tp + fp) : 0, recall: tp + fn ? tp / (tp + fn) : 0, support: tp + fn };
  }
  const hidePred = details.filter((d) => d.predictedAction === "HIDE");
  const hideFalse = hidePred.filter((d) => d.expectedDecision && d.expectedDecision !== "HIDE");
  const hideExpected = details.filter((d) => d.expectedDecision === "HIDE");
  const hideMissed = hideExpected.filter((d) => d.predictedAction !== "HIDE");
  return {
    accuracy: details.length ? details.filter((d) => d.correct).length / details.length : 0,
    total: details.length,
    perCategory,
    hide: { predicted: hidePred.length, falsePositives: hideFalse.length, falsePositiveRate: hidePred.length ? hideFalse.length / hidePred.length : 0, recall: hideExpected.length ? (hideExpected.length - hideMissed.length) / hideExpected.length : 0 },
    complaintPreserved: (() => { const c = details.filter((d) => d.expected === "COMPLAINT" || d.expected === "NEGATIVE"); return c.length ? c.filter((d) => d.predictedAction !== "HIDE").length / c.length : 1; })(),
  };
}
