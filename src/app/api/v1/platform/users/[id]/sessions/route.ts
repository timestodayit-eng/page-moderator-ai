import { api } from "@/server/http";
import { adminRevokeSessions } from "@/server/platform/admin";

export const DELETE = api({ auth: "platform" }, async ({ user, params, ip }) => ({ revoked: await adminRevokeSessions(user!.id, params.id, { ip }) }));
