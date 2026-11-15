import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { Errors } from "@/server/errors";
import { classifyComment, computeSignals } from "@/server/moderation/classifier";
import { complete, parseJsonObject, type Provider } from "@/server/ai/gateway";
import { retrieveKnowledge } from "@/server/agents/knowledge";

/** Agent playground: run a sample comment/message through a specific version without touching Facebook. */
export const POST = api({ permission: "agents.configure", body: z.object({ text: z.string().min(1).max(4000), versionId: z.string().optional(), authorName: z.string().max(80).optional() }), rateLimit: { name: "agent-test", limit: 60, windowSec: 3600, by: "user" } }, async ({ ws, params, body }) => {
  const agent = await prisma.agent.findFirst({ where: { id: params.id, workspaceId: ws!.workspace.id } });
  if (!agent) throw Errors.notFound("Agent");
  const version = await prisma.agentVersion.findFirst({ where: { agentId: agent.id, ...(body.versionId ? { id: body.versionId } : agent.activeVersionId ? { id: agent.activeVersionId } : {}) }, orderBy: { version: "desc" } });
  if (!version) throw Errors.notFound("Version");
  const cfg = { id: agent.id, versionId: version.id, instructions: version.instructions, provider: version.provider as Provider, model: version.model, temperature: version.temperature, languages: version.languages, tone: version.tone, safetyRules: version.safetyRules, knowledgeSourceIds: version.knowledgeSourceIds };
  if (agent.purpose === "MODERATION") {
    const page = await prisma.connectedPage.findFirst({ where: { workspaceId: ws!.workspace.id }, select: { id: true, fbPageId: true } });
    const signals = await computeSignals({ pageId: page?.id ?? "test", fbPageId: page?.fbPageId ?? "test", message: body.text, createdTime: new Date() });
    const r = await classifyComment({ workspaceId: ws!.workspace.id, pageId: page?.id ?? "test", message: body.text, authorName: body.authorName, signals, agent: cfg, businessName: ws!.workspace.name, purpose: "TEST" });
    return { kind: "classification", result: r.classification, signals, model: r.meta.model, provider: r.meta.provider, latencyMs: r.meta.latencyMs, tokens: r.meta.tokensIn + r.meta.tokensOut, knowledgeUsed: r.knowledgeUsed };
  }
  const knowledge = await retrieveKnowledge(ws!.workspace.id, body.text, { sourceIds: version.knowledgeSourceIds, limit: 5 });
  const sys = [`You are "${agent.name}" for ${ws!.workspace.name}. ${version.instructions}`, `Tone: ${version.tone}. Languages: ${version.languages.join(", ")}. Reply in the user's language.`, version.safetyRules ? `Safety rules: ${version.safetyRules}` : "", version.responseConstraints ? `Constraints: ${version.responseConstraints}` : "", version.escalationRules ? `Escalate (set escalate=true) when: ${version.escalationRules}` : "", knowledge.length ? `Approved knowledge:\n${knowledge.map((k, i) => `[${i + 1}] ${k.content}`).join("\n")}` : "No approved knowledge: never invent facts, prices or salaries.", `Return JSON {"reply": string, "confidence": number, "escalate": boolean, "reason": string}`].filter(Boolean).join("\n\n");
  const res = await complete({ workspaceId: ws!.workspace.id, purpose: "TEST", provider: cfg.provider, model: cfg.model, temperature: cfg.temperature, json: true, maxTokens: 600, agentId: agent.id, agentVersionId: version.id, messages: [{ role: "system", content: sys }, { role: "user", content: body.text }] });
  return { kind: "reply", result: parseJsonObject(res.text), model: res.model, provider: res.provider, latencyMs: res.latencyMs, tokens: res.tokensIn + res.tokensOut, knowledgeUsed: knowledge.length };
});
