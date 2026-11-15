import { z } from "zod";
import { api } from "@/server/http";
import { addLeadNote } from "@/server/crm/service";

export const POST = api({ permission: "crm.access", body: z.object({ body: z.string().min(1).max(4000), type: z.enum(["NOTE", "CALL", "MESSAGE"]).default("NOTE") }) }, async ({ ws, params, body }) => ({ activity: await addLeadNote(ws!, params.id, body.body, body.type) }));
