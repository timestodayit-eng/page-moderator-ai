import { z } from "zod";
import { api } from "@/server/http";
import { createRole, deleteRole, listRoles, updateRole } from "@/server/platform/team";
import { PERMISSIONS } from "@/server/rbac/permissions";

export const GET = api({ permission: "team.manage" }, async ({ ws }) => ({ roles: await listRoles(ws!.workspace.id), catalogue: PERMISSIONS }));

export const POST = api({ permission: "team.manage", body: z.object({ name: z.string().trim().min(2).max(60), description: z.string().max(300).optional(), permissions: z.array(z.string()).max(50) }) }, async ({ ws, body, ip }) => {
  const role = await createRole(ws!, body, { ip });
  return { role: { id: role.id, key: role.key, name: role.name } };
});

export const PATCH = api({ permission: "team.manage", body: z.object({ roleId: z.string().min(1), name: z.string().trim().min(2).max(60).optional(), description: z.string().max(300).optional(), permissions: z.array(z.string()).max(50).optional() }) }, async ({ ws, body, ip }) => {
  await updateRole(ws!, body.roleId, body, { ip });
  return { ok: true };
});

export const DELETE = api({ permission: "team.manage", body: z.object({ roleId: z.string().min(1) }) }, async ({ ws, body, ip }) => {
  await deleteRole(ws!, body.roleId, { ip });
  return { ok: true };
});
