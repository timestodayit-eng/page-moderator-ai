import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { createWorkspace, listUserWorkspaces } from "@/server/platform/workspaces";

export const GET = api({}, async ({ user }) => ({ workspaces: await listUserWorkspaces(user!.id) }));

/** A verified user may create additional workspaces (each gets its own trial). */
export const POST = api({ body: z.object({ name: z.string().trim().min(2).max(120) }), rateLimit: { name: "ws-create", limit: 5, windowSec: 86400, by: "user" } }, async ({ body, user }) => {
  const ws = await prisma.$transaction((tx) => createWorkspace({ name: body.name, ownerUserId: user!.id, startTrial: true }, tx));
  return { workspace: { id: ws.id, slug: ws.slug, name: ws.name } };
});
