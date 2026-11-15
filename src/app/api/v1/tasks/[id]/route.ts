import { api } from "@/server/http";
import { completeTask } from "@/server/crm/service";

export const POST = api({ permission: "crm.access" }, async ({ ws, params }) => {
  await completeTask(ws!, params.id);
  return { ok: true };
});
