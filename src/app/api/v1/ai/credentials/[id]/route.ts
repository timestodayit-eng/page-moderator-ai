import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";

/** Revoke a key. Workspace keys need ai.credentials; a personal key can always be revoked by its owner. */
export const DELETE = api({ permission: "agents.configure" }, async ({ ws, params, ip }) => {
  const c = await prisma.aiCredential.findFirst({ where: { id: params.id, workspaceId: ws!.workspace.id } });
  if (!c) throw Errors.notFound("Credential");
  const own = c.ownerUserId === ws!.user.id;
  if (!own && (c.ownerUserId || !ws!.permissions.has("ai.credentials"))) throw Errors.forbidden(c.ownerUserId ? "That key belongs to another team member" : "Missing permission: ai.credentials");
  await prisma.aiCredential.update({ where: { id: c.id }, data: { status: "REVOKED", keyEnc: "revoked" } });
  await audit({ workspaceId: ws!.workspace.id, actorUserId: ws!.user.id, action: "ai.credential_revoked", targetType: "AiCredential", targetId: c.id, ip, meta: { scope: c.ownerUserId ? "PERSONAL" : "WORKSPACE" } });
  return { ok: true };
});
