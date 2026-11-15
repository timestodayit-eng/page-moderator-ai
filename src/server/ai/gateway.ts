import { prisma } from "../db";
import { env } from "../env";
import { decrypt } from "../crypto";
import { log } from "../log";
import { Errors } from "../errors";
import { platformAiSpendThisMonth, reserveAiQuota } from "../billing/usage";

export type Provider = "openai" | "gemini" | "deepseek";
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type CompletionRequest = { messages: ChatMessage[]; model?: string; temperature?: number; maxTokens?: number; json?: boolean };
export type CompletionResult = { text: string; tokensIn: number; tokensOut: number; model: string; provider: Provider; latencyMs: number; costMicroUsd: number };

export class AiError extends Error {
  constructor(
    public code: "NOT_CONFIGURED" | "BUDGET" | "PROVIDER" | "INVALID_KEY" | "RATE_LIMIT" | "TIMEOUT" | "BAD_OUTPUT" | "INACTIVE",
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}

/** Approximate list prices (USD per 1M tokens) for cost tracking. Super Admin can override via settings.ai.prices. */
const DEFAULT_PRICES: Record<string, { in: number; out: number }> = {
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gemini-2.5-flash": { in: 0.3, out: 2.5 },
  "gemini-2.5-pro": { in: 1.25, out: 10 },
  "gemini-2.0-flash": { in: 0.1, out: 0.4 },
  "deepseek-chat": { in: 0.27, out: 1.1 },
  "deepseek-reasoner": { in: 0.55, out: 2.19 },
};

export function estimateCostMicroUsd(model: string, tokensIn: number, tokensOut: number, prices: Record<string, { in: number; out: number }> = DEFAULT_PRICES) {
  const p = prices[model] ?? { in: 1, out: 3 };
  return Math.round(((tokensIn * p.in + tokensOut * p.out) / 1_000_000) * 1_000_000);
}

export const PROVIDER_MODELS: Record<Provider, string[]> = {
  openai: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
};

// ───────────────────────────── Provider adapters ─────────────────────────────

async function withTimeout<T>(p: Promise<T>, ms: number) {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new AiError("TIMEOUT", `AI request timed out after ${ms}ms`, true)), ms))]);
}

function mapHttpError(provider: Provider, status: number, body: string): AiError {
  if (status === 401 || status === 403) return new AiError("INVALID_KEY", `${provider}: API key rejected (${status})`);
  if (status === 429) return new AiError("RATE_LIMIT", `${provider}: rate limited`, true);
  if (status >= 500) return new AiError("PROVIDER", `${provider}: server error ${status}`, true);
  return new AiError("PROVIDER", `${provider}: ${status} ${body.slice(0, 200)}`);
}

async function openaiCompatible(baseUrl: string, provider: Provider, apiKey: string, req: CompletionRequest, model: string): Promise<CompletionResult> {
  const started = Date.now();
  const res = await withTimeout(
    fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: req.messages, temperature: req.temperature ?? 0.2, max_tokens: req.maxTokens ?? 800, ...(req.json ? { response_format: { type: "json_object" } } : {}) }),
    }),
    env().AI_REQUEST_TIMEOUT_MS,
  );
  if (!res.ok) throw mapHttpError(provider, res.status, await res.text());
  const data = (await res.json()) as { choices: { message: { content: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number }; model?: string };
  const text = data.choices?.[0]?.message?.content ?? "";
  const tokensIn = data.usage?.prompt_tokens ?? 0;
  const tokensOut = data.usage?.completion_tokens ?? 0;
  return { text, tokensIn, tokensOut, model: data.model ?? model, provider, latencyMs: Date.now() - started, costMicroUsd: estimateCostMicroUsd(model, tokensIn, tokensOut) };
}

async function gemini(apiKey: string, req: CompletionRequest, model: string): Promise<CompletionResult> {
  const started = Date.now();
  const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents = req.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const res = await withTimeout(
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents, generationConfig: { temperature: req.temperature ?? 0.2, maxOutputTokens: req.maxTokens ?? 800, ...(req.json ? { responseMimeType: "application/json" } : {}) } }),
    }),
    env().AI_REQUEST_TIMEOUT_MS,
  );
  if (!res.ok) throw mapHttpError("gemini", res.status, await res.text());
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const tokensIn = data.usageMetadata?.promptTokenCount ?? 0;
  const tokensOut = data.usageMetadata?.candidatesTokenCount ?? 0;
  return { text, tokensIn, tokensOut, model, provider: "gemini", latencyMs: Date.now() - started, costMicroUsd: estimateCostMicroUsd(model, tokensIn, tokensOut) };
}

export async function callProvider(provider: Provider, apiKey: string, req: CompletionRequest, model: string): Promise<CompletionResult> {
  switch (provider) {
    case "openai":
      return openaiCompatible(env().OPENAI_BASE_URL.replace(/\/$/, ""), "openai", apiKey, req, model);
    case "deepseek":
      return openaiCompatible(env().DEEPSEEK_BASE_URL.replace(/\/$/, ""), "deepseek", apiKey, req, model);
    case "gemini":
      return gemini(apiKey, req, model);
  }
}

// ───────────────────────────── Credential resolution ─────────────────────────────

export type ResolvedCredential = { provider: Provider; apiKey: string; mode: "PLATFORM" | "BYOK"; credentialId?: string; defaultModel: string };

export function platformKey(provider: Provider): string | undefined {
  const e = env();
  return provider === "openai" ? e.OPENAI_API_KEY : provider === "gemini" ? e.GEMINI_API_KEY : e.DEEPSEEK_API_KEY;
}
export function platformDefaultModel(provider: Provider) {
  const e = env();
  return provider === "openai" ? e.OPENAI_MODEL : provider === "gemini" ? e.GEMINI_MODEL : e.DEEPSEEK_MODEL;
}

/**
 * Resolve which credential to use for a workspace.
 *  - BYOK workspaces use their own key for the requested provider. If it is INVALID/missing, we do NOT fall
 *    back to platform credentials unless the Super Admin enabled `allowPlatformFallback` for that workspace.
 *  - Platform-managed workspaces use platform keys, counted against their subscription allowance.
 */
export async function resolveCredential(workspaceId: string, preferredProvider?: Provider): Promise<ResolvedCredential> {
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { aiCredentialMode: true, aiProvider: true, allowPlatformFallback: true } });
  const aiSetting = await prisma.platformSetting.findUnique({ where: { key: "ai" } });
  const platformDefault = ((aiSetting?.value as { defaultProvider?: Provider })?.defaultProvider ?? env().DEFAULT_AI_PROVIDER) as Provider;
  const provider = (preferredProvider ?? (ws.aiProvider as Provider | null) ?? platformDefault) as Provider;

  if (ws.aiCredentialMode === "BYOK") {
    const cred = await prisma.aiCredential.findFirst({ where: { workspaceId, provider, status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
    if (cred) return { provider, apiKey: decrypt(cred.keyEnc), mode: "BYOK", credentialId: cred.id, defaultModel: platformDefaultModel(provider) };
    if (!ws.allowPlatformFallback) throw new AiError("NOT_CONFIGURED", `No active ${provider} API key for this workspace (BYOK). Add a key in Settings → AI, or ask the platform to allow fallback.`);
    log.warn("BYOK key unavailable; platform fallback is explicitly allowed", { workspaceId, provider });
  }
  const key = platformKey(provider);
  if (!key) {
    // try any configured platform provider
    for (const p of ["openai", "gemini", "deepseek"] as Provider[]) {
      const k = platformKey(p);
      if (k) return { provider: p, apiKey: k, mode: "PLATFORM", defaultModel: platformDefaultModel(p) };
    }
    throw new AiError("NOT_CONFIGURED", "No AI provider is configured on this server (set OPENAI_API_KEY, GEMINI_API_KEY or DEEPSEEK_API_KEY).");
  }
  return { provider, apiKey: key, mode: "PLATFORM", defaultModel: platformDefaultModel(provider) };
}

// ───────────────────────────── Metered completion ─────────────────────────────

export type MeteredInput = CompletionRequest & { workspaceId: string; purpose: "CLASSIFY" | "REPLY" | "TEST" | "EVAL" | "MESSENGER"; provider?: Provider; agentId?: string | null; agentVersionId?: string | null; ref?: { type: string; id: string } };

/**
 * The only entry point application code uses to talk to an LLM:
 *  1) resolve credential (BYOK vs platform)  2) reserve quota atomically  3) call provider
 *  4) settle usage counters  5) record AiUsage row (success or failure)  6) platform budget guard.
 */
export async function complete(input: MeteredInput): Promise<CompletionResult> {
  const cred = await resolveCredential(input.workspaceId, input.provider);
  const model = input.model && PROVIDER_MODELS[cred.provider].includes(input.model) ? input.model : cred.defaultModel;

  if (cred.mode === "PLATFORM") {
    const aiSetting = await prisma.platformSetting.findUnique({ where: { key: "ai" } });
    const cap = (aiSetting?.value as { monthlyPlatformBudgetMicroUsd?: number })?.monthlyPlatformBudgetMicroUsd;
    if (cap && (await platformAiSpendThisMonth()) >= cap) throw new AiError("BUDGET", "Platform-wide monthly AI budget reached. Super Admin must raise the budget.");
  }
  const estimate = estimateCostMicroUsd(model, 1500, 400);
  const reservation = await reserveAiQuota(input.workspaceId, estimate, cred.mode);
  if (!reservation.ok) {
    await prisma.aiUsage.create({ data: { workspaceId: input.workspaceId, agentId: input.agentId ?? null, agentVersionId: input.agentVersionId ?? null, provider: cred.provider, model, credentialMode: cred.mode, purpose: input.purpose, success: false, errorCode: reservation.reason, refType: input.ref?.type, refId: input.ref?.id } });
    if (reservation.reason === "SUBSCRIPTION_INACTIVE") throw new AiError("INACTIVE", "Subscription is not active; AI processing paused.");
    throw new AiError("BUDGET", reservation.reason === "AI_BUDGET_LIMIT" ? "Monthly AI budget for this workspace is exhausted." : "Monthly AI request limit reached.");
  }
  try {
    const result = await callProvider(cred.provider, cred.apiKey, { ...input, model }, model);
    await reservation.settle(result.costMicroUsd);
    await prisma.aiUsage.create({ data: { workspaceId: input.workspaceId, agentId: input.agentId ?? null, agentVersionId: input.agentVersionId ?? null, provider: cred.provider, model: result.model, credentialMode: cred.mode, purpose: input.purpose, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costMicroUsd: BigInt(result.costMicroUsd), latencyMs: result.latencyMs, success: true, refType: input.ref?.type, refId: input.ref?.id } });
    return result;
  } catch (err) {
    await reservation.release();
    const code = err instanceof AiError ? err.code : "PROVIDER";
    await prisma.aiUsage.create({ data: { workspaceId: input.workspaceId, agentId: input.agentId ?? null, agentVersionId: input.agentVersionId ?? null, provider: cred.provider, model, credentialMode: cred.mode, purpose: input.purpose, success: false, errorCode: code, refType: input.ref?.type, refId: input.ref?.id } });
    if (code === "INVALID_KEY" && cred.credentialId) {
      await prisma.aiCredential.update({ where: { id: cred.credentialId }, data: { status: "INVALID", lastError: (err as Error).message.slice(0, 300) } });
    }
    throw err;
  }
}

/** Validate a BYOK key with a minimal request before storing it. */
export async function verifyApiKey(provider: Provider, apiKey: string) {
  const model = PROVIDER_MODELS[provider][0];
  try {
    await callProvider(provider, apiKey, { messages: [{ role: "user", content: "Reply with OK." }], maxTokens: 5 }, model);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export function assertProvider(p: string): Provider {
  if (p === "openai" || p === "gemini" || p === "deepseek") return p;
  throw Errors.badRequest("Unknown AI provider");
}

/** Extract the first JSON object from a model response (handles ```json fences). */
export function parseJsonObject<T>(text: string): T {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new AiError("BAD_OUTPUT", "Model did not return JSON");
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    throw new AiError("BAD_OUTPUT", "Model returned malformed JSON");
  }
}
