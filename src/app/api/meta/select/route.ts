import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { connectSelectedPages } from "@/server/meta/pages";
import { decryptJson, sha256 } from "@/server/crypto";
import { Errors } from "@/server/errors";

/** GET ?token= → list discovered Pages for the selection screen; POST → connect chosen Pages. */
export const GET = api({ permission: "pages.manage" }, async ({ req, ws }) => {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const row = await prisma.oAuthState.findUnique({ where: { stateHash: sha256(token) } });
  if (!row || row.provider !== "meta-selection" || row.usedAt || row.expiresAt <= new Date() || row.workspaceId !== ws!.workspace.id || row.userId !== ws!.user.id) throw Errors.badRequest("Selection expired. Please reconnect with Facebook.");
  const held = decryptJson<{ pages: { id: string; name: string; category?: string; pictureUrl?: string; tasks: string[] }[]; granted: string[] }>(row.payloadEnc!);
  const existing = await prisma.connectedPage.findMany({ where: { fbPageId: { in: held.pages.map((p) => p.id) }, status: { not: "DISCONNECTED" } }, select: { fbPageId: true, workspaceId: true } });
  return {
    granted: held.granted,
    pages: held.pages.map((p) => ({ id: p.id, name: p.name, category: p.category, pictureUrl: p.pictureUrl, tasks: p.tasks, alreadyConnected: existing.some((e) => e.fbPageId === p.id && e.workspaceId === ws!.workspace.id), connectedElsewhere: existing.some((e) => e.fbPageId === p.id && e.workspaceId !== ws!.workspace.id) })),
  };
});

export const POST = api({ permission: "pages.manage", body: z.object({ token: z.string().min(10), pageIds: z.array(z.string()).min(1).max(50) }) }, async ({ ws, body, ip }) => connectSelectedPages(ws!, body.token, body.pageIds, { ip }));
