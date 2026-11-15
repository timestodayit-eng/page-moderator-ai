import { z } from "zod";
import { api } from "@/server/http";
import { changeMemberRole, inviteMember, listMembers, removeMember, setMemberStatus } from "@/server/platform/team";

export const GET = api({ permission: "team.manage" }, async ({ ws }) => listMembers(ws!.workspace.id));

export const POST = api({ permission: "team.manage", body: z.object({ email: z.email(), roleId: z.string().min(1) }) }, async ({ ws, body, ip }) => {
  const inv = await inviteMember(ws!, body, { ip });
  return { invitation: { id: inv.id, email: inv.email, expiresAt: inv.expiresAt } };
});

const patch = z.object({ membershipId: z.string().min(1), roleId: z.string().optional(), status: z.enum(["ACTIVE", "SUSPENDED"]).optional() });
export const PATCH = api({ permission: "team.manage", body: patch }, async ({ ws, body, ip }) => {
  if (body.roleId) await changeMemberRole(ws!, body.membershipId, body.roleId, { ip });
  if (body.status) await setMemberStatus(ws!, body.membershipId, body.status, { ip });
  return { ok: true };
});

export const DELETE = api({ permission: "team.manage", body: z.object({ membershipId: z.string().min(1) }) }, async ({ ws, body, ip }) => {
  await removeMember(ws!, body.membershipId, { ip });
  return { ok: true };
});
