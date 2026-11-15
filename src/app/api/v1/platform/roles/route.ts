import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { PERMISSIONS } from "@/server/rbac/permissions";

export const GET = api({ auth: "platform-support" }, async () => {
  const roles = await prisma.role.findMany({ where: { workspaceId: null }, orderBy: { rank: "desc" }, include: { permissions: { select: { permissionKey: true } } } });
  return { roles: roles.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, rank: r.rank, isSystem: r.isSystem, permissions: r.permissions.map((p) => p.permissionKey) })), catalogue: PERMISSIONS };
});
