import { z } from "zod";
import { api } from "@/server/http";
import { disconnectPage } from "@/server/meta/pages";
import { prisma } from "@/server/db";
import { Errors } from "@/server/errors";

/** Requires the client to echo the Page name — the confirmation dialog must identify the exact Page. */
export const POST = api({ permission: "pages.disconnect", body: z.object({ confirmName: z.string() }) }, async ({ ws, params, body, ip }) => {
  const page = await prisma.connectedPage.findFirst({ where: { id: params.id, workspaceId: ws!.workspace.id } });
  if (!page) throw Errors.notFound("Page");
  if (body.confirmName.trim() !== page.name.trim()) throw Errors.badRequest("Confirmation name does not match the Page");
  return disconnectPage(ws!, params.id, { ip });
});
