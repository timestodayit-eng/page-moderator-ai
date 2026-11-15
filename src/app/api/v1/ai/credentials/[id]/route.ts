import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";

export const DELETE = api({ permission: "ai.credentials" }, async ({ ws, params, ip }) => {
  const c = await prisma.aiCredential.findFirst({ where: { id: params.id, workspaceId: ws!.workspace.id } });
  if (!c) throw Errors.notFound("Credential");
  await prisma.aiCredential.update({ where: { id: c.id }, data: { status: "REVOKED", keyEnc: "revoked" } });
  await audit({ workspaceId: ws!.workspace.id, actorUserId: ws!.user.id, action: "ai.credential_revoked", targetType: "AiCredential", targetId: c.id, ip });
  return { ok: true };
});
