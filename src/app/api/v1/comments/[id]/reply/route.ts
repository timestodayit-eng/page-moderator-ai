import { z } from "zod";
import { api } from "@/server/http";
import { replyToComment } from "@/server/moderation/review";

export const POST = api({ permission: "comments.reply", body: z.object({ message: z.string().min(1).max(2000) }) }, async ({ ws, params, body, ip }) => replyToComment(ws!, params.id, body.message, { ip }));
