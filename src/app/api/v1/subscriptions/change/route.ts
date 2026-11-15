import { z } from "zod";
import { api } from "@/server/http";
import { changePlan } from "@/server/billing/lifecycle";

export const POST = api({ permission: "billing.manage", body: z.object({ planKey: z.string(), interval: z.enum(["MONTHLY", "YEARLY"]).default("MONTHLY") }) }, async ({ ws, body }) => changePlan(ws!.workspace.id, body.planKey, body.interval, ws!.user.id));
