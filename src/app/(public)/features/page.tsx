export const metadata = { title: "Features" };
const sections = [
  { title: "Three moderation modes", items: ["Shadow mode — AI analyses but changes nothing on Facebook", "Human approval — AI recommends, your team approves", "Automatic — only for categories you enable, above confidence thresholds, with hourly caps and a per-Page kill switch"] },
  { title: "Understanding, not keyword matching", items: ["Bengali, Banglish and English in one model", "17 categories including inquiry, sales, complaint, negative, defamation/fraud accusations, abuse, harassment, hate speech, spam, scam, suspicious link, PII exposure", "Recognises Bengali and Banglish slang, sarcasm and negative-vibe comments by meaning — no keyword lists", "Hiding negative-sentiment comments is a per-Page choice; off by default", "Every decision stores reasoning, confidence, risk score, model, policy version and the action taken"] },
  { title: "AI Agent Studio", items: ["Separate agents for moderation, public replies, support, sales, complaints and Messenger", "Choose OpenAI, Google Gemini or DeepSeek per agent; bring your own key or use platform credits", "Versioned instructions, tone, safety rules, escalation rules and knowledge sources", "Playground to test any version before activating"] },
  { title: "Training Center", items: ["Upload company info, FAQs, pricing, policies, PDFs and CSVs", "Label examples, mark false positives / negatives, correct categories", "Run evaluations — precision, recall and false-positive rate per category — before enabling auto-hide"] },
  { title: "Messenger inbox & CRM", items: ["Lifecycle New → Open → Assigned → Pending → Resolved → Closed", "Reply lock prevents two agents (or the AI) replying at once", "Respects the Meta 24-hour messaging window and tags", "Kanban pipeline, follow-up reminders, CSV export"] },
  { title: "Operate as a SaaS", items: ["Isolated workspaces with their own Pages, agents, team and billing", "Custom roles and a full permission matrix", "Super Admin Control Center: customers, users, plans, invoices, email center, AI costs, audit logs, support access", "Transactional email in English and Bengali"] },
];
export default function Features() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-text">Everything you need to run Pages at scale</h1>
      <p className="mt-3 max-w-2xl text-text-2">Designed around safety first: nothing is automated until you explicitly enable it, and every action is reversible and audited.</p>
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        {sections.map((s) => (
          <div key={s.title} className="rounded-card border border-border bg-surface p-6 shadow-soft">
            <h2 className="text-[16px] font-semibold text-text">{s.title}</h2>
            <ul className="mt-3 space-y-2 text-sm text-text-2">
              {s.items.map((i) => (
                <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />{i}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
