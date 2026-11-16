import { z } from "zod";
import { api } from "@/server/http";
import { reviewDecision } from "@/server/moderation/review";

const schema = z.object({ outcome: z.enum(["APPROVE", "REJECT"]), note: z.string().max(500).optional(), feedback: z.enum(["CORRECT", "FALSE_POSITIVE", "FALSE_NEGATIVE", "WRONG_CATEGORY"]).optional(), correctedCategory: z.string().optional(), editedReply: z.string().max(2000).optional(), saveAsExample: z.boolean().optional(), always: z.boolean().optional(), alwaysScope: z.enum(["PAGE", "WORKSPACE"]).optional(), alwaysNote: z.string().max(300).optional() });
export const POST = api({ permission: "moderation.approve", body: schema }, async ({ ws, params, body, ip }) => reviewDecision(ws!, params.id, body, { ip }));
