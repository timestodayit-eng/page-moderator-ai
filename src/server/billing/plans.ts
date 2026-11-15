export type PlanLimits = {
  pages: number;
  users: number;
  agents: number;
  commentsPerMonth: number;
  aiRequestsPerMonth: number;
  aiBudgetMicroUsd: number; // platform-managed AI spend allowance per month (1 USD = 1_000_000)
  autoRepliesPerMonth: number;
  storageMb: number;
};

export const DEFAULT_PLANS: {
  key: string; name: string; description: string; priceMonthlyCents: number; priceYearlyCents: number; trialDays: number; limits: PlanLimits; features: string[]; sortOrder: number; isPublic: boolean;
}[] = [
  {
    key: "starter", name: "Starter", description: "For small businesses with a single Page and limited AI usage.",
    priceMonthlyCents: 2900, priceYearlyCents: 29000, trialDays: 14, sortOrder: 1, isPublic: true,
    limits: { pages: 1, users: 3, agents: 2, commentsPerMonth: 3000, aiRequestsPerMonth: 4000, aiBudgetMicroUsd: 5_000_000, autoRepliesPerMonth: 500, storageMb: 200 },
    features: ["AI comment classification", "Shadow & approval moderation", "Messenger inbox", "Basic CRM"],
  },
  {
    key: "growth", name: "Growth", description: "For growing businesses that run several Pages and agents.",
    priceMonthlyCents: 7900, priceYearlyCents: 79000, trialDays: 14, sortOrder: 2, isPublic: true,
    limits: { pages: 5, users: 10, agents: 8, commentsPerMonth: 20000, aiRequestsPerMonth: 25000, aiBudgetMicroUsd: 25_000_000, autoRepliesPerMonth: 3000, storageMb: 2000 },
    features: ["Everything in Starter", "Automatic moderation", "AI replies", "AI Training Center", "Analytics exports"],
  },
  {
    key: "business", name: "Business", description: "For agencies and larger teams with high volume.",
    priceMonthlyCents: 19900, priceYearlyCents: 199000, trialDays: 14, sortOrder: 3, isPublic: true,
    limits: { pages: 20, users: 40, agents: 30, commentsPerMonth: 100000, aiRequestsPerMonth: 120000, aiBudgetMicroUsd: 100_000_000, autoRepliesPerMonth: 15000, storageMb: 10000 },
    features: ["Everything in Growth", "Custom roles", "Priority support", "BYOK AI keys"],
  },
  {
    key: "enterprise", name: "Enterprise", description: "Custom limits, dedicated support and administration capabilities.",
    priceMonthlyCents: 0, priceYearlyCents: 0, trialDays: 0, sortOrder: 4, isPublic: true,
    limits: { pages: 1000, users: 1000, agents: 500, commentsPerMonth: 10_000_000, aiRequestsPerMonth: 10_000_000, aiBudgetMicroUsd: 2_000_000_000, autoRepliesPerMonth: 1_000_000, storageMb: 500000 },
    features: ["Everything in Business", "Custom limits", "SLA", "Dedicated onboarding"],
  },
];

export const DEFAULT_LIMITS: PlanLimits = DEFAULT_PLANS[0].limits;

export function mergeLimits(planLimits: unknown, overrides: unknown): PlanLimits {
  const base = { ...DEFAULT_LIMITS, ...((planLimits as Partial<PlanLimits>) ?? {}) };
  const o = (overrides as Partial<PlanLimits>) ?? {};
  for (const k of Object.keys(o) as (keyof PlanLimits)[]) if (typeof o[k] === "number") base[k] = o[k] as number;
  return base;
}
