export function AuthCard({ title, description, children, footer }: { title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="rounded-card border border-border bg-surface p-7 shadow-card">
      <h1 className="text-[22px] font-semibold tracking-tight text-text">{title}</h1>
      {description ? <p className="mt-1.5 text-sm text-text-2">{description}</p> : null}
      <div className="mt-6">{children}</div>
      {footer ? <div className="mt-6 border-t border-border pt-5 text-center text-[13px] text-text-2">{footer}</div> : null}
    </div>
  );
}
