import Link from "next/link";
import { prisma } from "@/server/db";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

export default async function Pricing() {
  const plans = await prisma.plan.findMany({ where: { isActive: true, isPublic: true }, orderBy: { sortOrder: "asc" } });
  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-text">Simple, transparent pricing</h1>
        <p className="mt-3 text-text-2">Every plan starts with a free trial. Internal businesses run on exempt enterprise workspaces.</p>
      </div>
      <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((p) => {
          const l = p.limits as Record<string, number>;
          const custom = p.priceMonthlyCents === 0;
          return (
            <div key={p.id} className={`flex flex-col rounded-card border bg-surface p-6 shadow-soft ${p.key === "growth" ? "border-primary ring-4 ring-primary/10" : "border-border"}`}>
              <div className="text-[13px] font-semibold uppercase tracking-wider text-text-2">{p.name}</div>
              <div className="mt-2 text-3xl font-semibold text-text">{custom ? "Custom" : formatMoney(p.priceMonthlyCents, p.currency)}{!custom ? <span className="text-sm font-normal text-text-3">/mo</span> : null}</div>
              <p className="mt-2 text-[13px] text-text-2">{p.description}</p>
              <ul className="mt-5 space-y-1.5 text-[13px] text-text-2">
                <li>{l.pages} Facebook Page{l.pages > 1 ? "s" : ""}</li>
                <li>{l.users} team members</li>
                <li>{l.agents} AI agents</li>
                <li>{l.commentsPerMonth.toLocaleString()} comments / month</li>
                <li>{l.aiRequestsPerMonth.toLocaleString()} AI requests / month</li>
                {p.features.map((f) => <li key={f}>{f}</li>)}
              </ul>
              <Link href={custom ? "/contact" : "/register"} className={`mt-6 inline-flex h-10 items-center justify-center rounded-sm text-sm font-medium ${p.key === "growth" ? "bg-primary text-white hover:bg-primary-hover" : "border border-border-strong text-text hover:bg-surface-2"}`}>{custom ? "Contact sales" : `Start ${p.trialDays}-day trial`}</Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
