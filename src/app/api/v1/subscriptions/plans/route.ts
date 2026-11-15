import { api } from "@/server/http";
import { prisma } from "@/server/db";

export const GET = api({ auth: "none" }, async () => ({ plans: await prisma.plan.findMany({ where: { isActive: true, isPublic: true }, orderBy: { sortOrder: "asc" }, select: { key: true, name: true, description: true, priceMonthlyCents: true, priceYearlyCents: true, currency: true, trialDays: true, limits: true, features: true } }) }));
