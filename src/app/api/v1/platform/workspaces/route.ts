import { z } from "zod";
import { api, paginate } from "@/server/http";
import { adminCreateWorkspace, listWorkspaces } from "@/server/platform/admin";

export const GET = api({ auth: "platform-support" }, async ({ req }) => {
  const { skip, take, page, pageSize } = paginate(req);
  const sp = req.nextUrl.searchParams;
  const data = await listWorkspaces({ search: sp.get("search") ?? undefined, status: sp.get("status") ?? undefined, type: sp.get("type") ?? undefined, plan: sp.get("plan") ?? undefined, skip, take });
  return { ...data, page, pageSize };
});

const create = z.object({ name: z.string().trim().min(2).max(120), ownerEmail: z.email(), ownerName: z.string().trim().min(2).max(80), type: z.enum(["INTERNAL", "CUSTOMER"]).default("CUSTOMER"), planKey: z.string().optional(), billingExempt: z.boolean().optional() });
export const POST = api({ auth: "platform", body: create }, async ({ user, body, ip, userAgent }) => {
  const ws = await adminCreateWorkspace(user!.id, body, { ip, userAgent });
  return { workspace: { id: ws.id, slug: ws.slug, name: ws.name } };
});
