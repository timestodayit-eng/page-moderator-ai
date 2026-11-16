import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { encrypt, last4 } from "@/server/crypto";
import { PROVIDERS, assertProvider, verifyApiKey, platformKey } from "@/server/ai/gateway";
import { audit } from "@/server/audit";
import { Errors } from "@/server/errors";

/**
 * Keys come in two kinds:
 *  - workspace keys (ownerUserId = null): managed by ai.credentials holders, used by default in BYOK mode
 *  - personal keys (ownerUserId = caller): any member who may configure agents can add their own OpenAI / Claude /
 *    Gemini / DeepSeek key and pin their agents to it. Only the owner can see or use a personal key.
 */
export const GET = api({ permission: ["agents.configure"] }, async ({ ws }) => {
  const manage = ws!.permissions.has("ai.credentials");
  const creds = await prisma.aiCredential.findMany({
    where: { workspaceId: ws!.workspace.id, OR: [{ ownerUserId: ws!.user.id }, ...(manage ? [{ ownerUserId: null }] : [])] },
    select: { id: true, provider: true, label: true, keyLast4: true, status: true, lastVerifiedAt: true, lastError: true, createdAt: true, ownerUserId: true },
    orderBy: { createdAt: "desc" },
  });
  const platform = PROVIDERS.filter((p) => Boolean(platformKey(p)));
  return { mode: ws!.workspace.aiCredentialMode, provider: ws!.workspace.aiProvider, canManageWorkspaceKeys: manage, credentials: creds.map((c) => ({ ...c, scope: c.ownerUserId ? "PERSONAL" : "WORKSPACE" })), platformProviders: platform, allowPlatformFallback: ws!.workspace.allowPlatformFallback };
});

export const POST = api({ permission: ["agents.configure"], body: z.object({ provider: z.string(), apiKey: z.string().min(10).max(500), label: z.string().max(60).optional(), scope: z.enum(["WORKSPACE", "PERSONAL"]).default("WORKSPACE") }) }, async ({ ws, body, ip }) => {
  const provider = assertProvider(body.provider);
  if (body.scope === "WORKSPACE" && !ws!.permissions.has("ai.credentials")) throw Errors.forbidden("Missing permission: ai.credentials (you can add a personal key instead)");
  const check = await verifyApiKey(provider, body.apiKey);
  if (!check.ok) throw Errors.badRequest(`The key was rejected by ${provider}: ${check.error}`);
  const ownerUserId = body.scope === "PERSONAL" ? ws!.user.id : null;
  const cred = await prisma.$transaction(async (tx) => {
    await tx.aiCredential.updateMany({ where: { workspaceId: ws!.workspace.id, provider, status: "ACTIVE", ownerUserId }, data: { status: "REVOKED" } });
    const c = await tx.aiCredential.create({ data: { workspaceId: ws!.workspace.id, ownerUserId, provider, label: body.label ?? "", keyEnc: encrypt(body.apiKey), keyLast4: last4(body.apiKey), lastVerifiedAt: new Date(), createdById: ws!.user.id } });
    await audit({ workspaceId: ws!.workspace.id, actorUserId: ws!.user.id, action: "ai.credential_added", targetType: "AiCredential", targetId: c.id, ip, meta: { provider, scope: body.scope } }, tx);
    return c;
  });
  return { credential: { id: cred.id, provider, keyLast4: cred.keyLast4, scope: body.scope } };
});

/** Switch between platform-managed and BYOK; choose preferred provider. */
export const PATCH = api({ permission: "ai.credentials", body: z.object({ mode: z.enum(["PLATFORM", "BYOK"]).optional(), provider: z.enum(["openai", "anthropic", "gemini", "deepseek"]).nullable().optional() }) }, async ({ ws, body, ip }) => {
  if (body.mode === "BYOK") {
    const n = await prisma.aiCredential.count({ where: { workspaceId: ws!.workspace.id, status: "ACTIVE", ownerUserId: null } });
    if (!n) throw Errors.badRequest("Add at least one API key before switching to Bring Your Own Key");
  }
  await prisma.workspace.update({ where: { id: ws!.workspace.id }, data: { aiCredentialMode: body.mode, aiProvider: body.provider } });
  await audit({ workspaceId: ws!.workspace.id, actorUserId: ws!.user.id, action: "ai.settings_updated", targetType: "Workspace", targetId: ws!.workspace.id, ip, meta: body });
  return { ok: true };
});
