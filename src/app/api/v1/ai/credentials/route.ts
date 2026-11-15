import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { encrypt, last4 } from "@/server/crypto";
import { assertProvider, verifyApiKey, platformKey } from "@/server/ai/gateway";
import { audit } from "@/server/audit";
import { Errors } from "@/server/errors";

export const GET = api({ permission: "ai.credentials" }, async ({ ws }) => {
  const creds = await prisma.aiCredential.findMany({ where: { workspaceId: ws!.workspace.id }, select: { id: true, provider: true, label: true, keyLast4: true, status: true, lastVerifiedAt: true, lastError: true, createdAt: true } });
  const platform = (["openai", "gemini", "deepseek"] as const).filter((p) => Boolean(platformKey(p)));
  return { mode: ws!.workspace.aiCredentialMode, provider: ws!.workspace.aiProvider, credentials: creds, platformProviders: platform, allowPlatformFallback: ws!.workspace.allowPlatformFallback };
});

export const POST = api({ permission: "ai.credentials", body: z.object({ provider: z.string(), apiKey: z.string().min(10).max(500), label: z.string().max(60).optional() }) }, async ({ ws, body, ip }) => {
  const provider = assertProvider(body.provider);
  const check = await verifyApiKey(provider, body.apiKey);
  if (!check.ok) throw Errors.badRequest(`The key was rejected by ${provider}: ${check.error}`);
  const cred = await prisma.$transaction(async (tx) => {
    await tx.aiCredential.updateMany({ where: { workspaceId: ws!.workspace.id, provider, status: "ACTIVE" }, data: { status: "REVOKED" } });
    const c = await tx.aiCredential.create({ data: { workspaceId: ws!.workspace.id, provider, label: body.label ?? "", keyEnc: encrypt(body.apiKey), keyLast4: last4(body.apiKey), lastVerifiedAt: new Date(), createdById: ws!.user.id } });
    await audit({ workspaceId: ws!.workspace.id, actorUserId: ws!.user.id, action: "ai.credential_added", targetType: "AiCredential", targetId: c.id, ip, meta: { provider } }, tx);
    return c;
  });
  return { credential: { id: cred.id, provider, keyLast4: cred.keyLast4 } };
});

/** Switch between platform-managed and BYOK; choose preferred provider. */
export const PATCH = api({ permission: "ai.credentials", body: z.object({ mode: z.enum(["PLATFORM", "BYOK"]).optional(), provider: z.enum(["openai", "gemini", "deepseek"]).nullable().optional() }) }, async ({ ws, body, ip }) => {
  if (body.mode === "BYOK") {
    const n = await prisma.aiCredential.count({ where: { workspaceId: ws!.workspace.id, status: "ACTIVE" } });
    if (!n) throw Errors.badRequest("Add at least one API key before switching to Bring Your Own Key");
  }
  await prisma.workspace.update({ where: { id: ws!.workspace.id }, data: { aiCredentialMode: body.mode, aiProvider: body.provider } });
  await audit({ workspaceId: ws!.workspace.id, actorUserId: ws!.user.id, action: "ai.settings_updated", targetType: "Workspace", targetId: ws!.workspace.id, ip, meta: body });
  return { ok: true };
});
