import { z } from "zod";
import { api } from "@/server/http";
import { bulkReview } from "@/server/moderation/review";

export const POST = api({ permission: "moderation.approve", body: z.object({ decisionIds: z.array(z.string()).min(1).max(50), outcome: z.enum(["APPROVE", "REJECT"]) }) }, async ({ ws, body, ip }) => ({ results: await bulkReview(ws!, body.decisionIds, body.outcome, { ip }) }));
