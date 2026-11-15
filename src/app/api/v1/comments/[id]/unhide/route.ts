import { z } from "zod";
import { api } from "@/server/http";
import { unhideComment } from "@/server/moderation/review";

export const POST = api({ permission: "comments.unhide", body: z.object({ note: z.string().max(500).optional() }) }, async ({ ws, params, body, ip }) => unhideComment(ws!, params.id, body.note, { ip }));
