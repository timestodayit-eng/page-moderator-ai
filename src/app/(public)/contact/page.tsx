import { env } from "@/server/env";
export const metadata = { title: "Contact" };
export default function Contact() {
  const support = env().EMAIL_SUPPORT_ADDRESS;
  return (
    <div className="mx-auto max-w-2xl px-5 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-text">Contact us</h1>
      <p className="mt-3 text-text-2">For enterprise plans, onboarding help or Meta App Review questions, email us and we will reply within one business day.</p>
      <div className="mt-8 rounded-card border border-border bg-surface p-6 shadow-soft">
        <div className="text-[13px] font-medium text-text-2">Support</div>
        <a href={`mailto:${support}`} className="mt-1 block text-lg font-medium text-primary">{support}</a>
        <p className="mt-4 text-sm text-text-2">Existing customers: sign in and open Settings → Security to request or approve support access. Platform staff can only read private messages after you approve a time-boxed, audited access grant.</p>
      </div>
    </div>
  );
}
