import { z } from "zod";
import { api } from "@/server/http";
import { adminSetSubscription } from "@/server/platform/admin";

const schema = z.object({
  planKey: z.string().optional(),
  status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "GRACE", "CANCELED", "EXPIRED", "SUSPENDED", "EXEMPT"]).optional(),
  extendDays: z.number().int().min(-365).max(3650).optional(),
  trialExtendDays: z.number().int().min(1).max(365).optional(),
  limitOverrides: z.record(z.string(), z.number().int().nonnegative()).optional(),
  discountPercent: z.number().int().min(0).max(100).optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
});
export const POST = api({ auth: "platform", body: schema }, async ({ user, params, body, ip }) => {
  await adminSetSubscription(user!.id, params.id, body, { ip });
  return { ok: true };
});
