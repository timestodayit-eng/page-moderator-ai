import { z } from "zod";
import { api } from "@/server/http";
import { hideComment } from "@/server/moderation/review";

export const POST = api({ permission: "comments.hide", body: z.object({ note: z.string().max(500).optional() }) }, async ({ ws, params, body, ip }) => hideComment(ws!, params.id, body.note, { ip }));
