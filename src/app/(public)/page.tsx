import Link from "next/link";
import { ShieldCheck, MessageSquare, Users, Sparkles, BarChart3, Lock } from "lucide-react";

const features = [
  { icon: ShieldCheck, title: "AI comment moderation", text: "Understands Bengali, Banglish and English. Separates real complaints from abuse, spam and scams, and hides only what your policy allows." },
  { icon: Sparkles, title: "Agent Studio & Training", text: "Build agents with your own knowledge, tone and safety rules. Review decisions, label mistakes, and measure precision before enabling automation." },
  { icon: MessageSquare, title: "Messenger inbox", text: "Assign conversations, add internal notes, use AI reply suggestions, and hand over to a human — without conflicting replies." },
  { icon: Users, title: "CRM & leads", text: "Turn comments and messages into leads, run a Kanban pipeline, and never miss a follow-up." },
  { icon: BarChart3, title: "Analytics", text: "Moderation accuracy, false-positive rate, response times, lead conversion and AI cost — per Page and per business." },
  { icon: Lock, title: "Built for multi-tenant SaaS", text: "Isolated workspaces, custom roles, audited Super Admin tools, subscription plans and usage limits." },
];

export default function Landing() {
  return (
    <div>
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-20 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-medium text-text-2 shadow-soft"><span className="h-1.5 w-1.5 rounded-full bg-success" /> Shadow mode by default — nothing is hidden until you approve it</span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-text sm:text-5xl">Moderate your Facebook Pages with AI that understands your customers</h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-text-2">Classify every comment, auto-hide spam and abuse under policies you control, reply to inquiries from approved knowledge, and manage Messenger and leads in one premium workspace.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/register" className="inline-flex h-12 items-center rounded-sm bg-primary px-6 text-[15px] font-medium text-white shadow-soft hover:bg-primary-hover">Start your free trial</Link>
          <Link href="/features" className="inline-flex h-12 items-center rounded-sm border border-border-strong bg-surface px-6 text-[15px] font-medium text-text hover:bg-surface-2">See how it works</Link>
        </div>
        <div className="mx-auto mt-14 max-w-4xl rounded-card border border-border bg-surface p-3 shadow-pop">
          <div className="rounded-sm bg-bg p-5 text-left">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["আপনাদের সার্ভিস সম্পর্কে বিস্তারিত জানতে চাই।", "Inquiry", "Reply suggested", "success"],
                ["আপনাদের সার্ভিস নিয়ে আমি সন্তুষ্ট নই।", "Legitimate complaint", "Flagged for review", "warning"],
                ["100% guaranteed visa — inbox now!! bit.ly/xyz", "Scam", "Eligible for auto-hide", "danger"],
              ].map(([text, cat, action, tone]) => (
                <div key={cat} className="rounded-sm border border-border bg-surface p-4">
                  <p className="font-bengali text-sm text-text">{text}</p>
                  <div className="mt-3 flex items-center justify-between text-[12px]">
                    <span className={`rounded-full px-2 py-0.5 font-medium ${tone === "success" ? "bg-success-soft text-success" : tone === "warning" ? "bg-warning-soft text-warning" : "bg-danger-soft text-danger"}`}>{cat}</span>
                    <span className="text-text-3">{action}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section className="border-t border-border bg-surface/60">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 py-16 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-card border border-border bg-surface p-6 shadow-soft">
              <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-primary-soft text-primary"><f.icon className="h-5 w-5" /></div>
              <h3 className="mt-4 text-[15px] font-semibold text-text">{f.title}</h3>
              <p className="mt-1.5 text-sm text-text-2">{f.text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
