import { z } from "zod";
import { api } from "@/server/http";
import { addNote } from "@/server/inbox/service";

export const POST = api({ permission: "inbox.manage", body: z.object({ body: z.string().min(1).max(4000) }) }, async ({ ws, params, body }) => ({ note: await addNote(ws!, params.id, body.body) }));
