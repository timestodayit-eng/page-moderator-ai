import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { upsertPlan } from "@/server/platform/admin";

export const GET = api({ auth: "platform-support" }, async () => ({
  plans: await prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { subscriptions: true } } } }),
}));

const schema = z.object({
  id: z.string().optional(),
  key: z.string().regex(/^[a-z0-9-]{2,30}$/),
  name: z.string().trim().min(2).max(60),
  description: z.string().max(300).optional(),
  priceMonthlyCents: z.number().int().nonnegative(),
  priceYearlyCents: z.number().int().nonnegative(),
  trialDays: z.number().int().min(0).max(365),
  limits: z.record(z.string(), z.number().int().nonnegative()),
  features: z.array(z.string().max(100)).max(30),
  isPublic: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int().optional(),
});
export const POST = api({ auth: "platform", body: schema }, async ({ user, body, ip }) => ({ plan: await upsertPlan(user!.id, body, { ip }) }));
