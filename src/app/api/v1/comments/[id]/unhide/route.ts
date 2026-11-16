import { z } from "zod";
import { api } from "@/server/http";
import { unhideComment } from "@/server/moderation/review";

const schema = z.object({ note: z.string().max(500).optional(), always: z.boolean().optional(), alwaysScope: z.enum(["PAGE", "WORKSPACE"]).optional(), alwaysNote: z.string().max(300).optional() });
export const POST = api({ permission: "comments.unhide", body: schema }, async ({ ws, params, body, ip }) => unhideComment(ws!, params.id, body.note, { ip }, body));
