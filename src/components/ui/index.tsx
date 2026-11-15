"use client";

import * as React from "react";
import { X, ChevronDown, Loader2, Check, AlertTriangle, Info, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/* ───────────────────────────── Button ───────────────────────────── */
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "outline" | "soft"; size?: "sm" | "md" | "lg" | "icon"; loading?: boolean };
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant = "primary", size = "md", loading, disabled, children, ...props }, ref) {
  const variants = {
    primary: "bg-primary text-white hover:bg-primary-hover shadow-soft",
    secondary: "bg-surface-2 text-text hover:bg-border",
    outline: "border border-border-strong bg-surface text-text hover:bg-surface-2",
    ghost: "text-text-2 hover:bg-surface-2 hover:text-text",
    soft: "bg-primary-soft text-primary hover:bg-primary/15",
    danger: "bg-danger text-white hover:brightness-95",
  };
  const sizes = { sm: "h-8 px-3 text-[13px] rounded-xs gap-1.5", md: "h-10 px-4 text-sm rounded-sm gap-2", lg: "h-12 px-5 text-[15px] rounded-sm gap-2", icon: "h-9 w-9 rounded-xs" };
  return (
    <button ref={ref} disabled={disabled || loading} className={cn("inline-flex items-center justify-center font-medium whitespace-nowrap transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none", variants[variant], sizes[size], className)} {...props}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
});

/* ───────────────────────────── Inputs ───────────────────────────── */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn("h-10 w-full rounded-sm border border-border bg-surface px-3.5 text-sm text-text placeholder:text-text-3 transition-colors hover:border-border-strong focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15 disabled:opacity-60", className)} {...props} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn("min-h-[96px] w-full rounded-sm border border-border bg-surface px-3.5 py-2.5 text-sm text-text placeholder:text-text-3 transition-colors hover:border-border-strong focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15 disabled:opacity-60", className)} {...props} />;
});

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn("h-10 w-full appearance-none rounded-sm border border-border bg-surface pl-3.5 pr-9 text-sm text-text transition-colors hover:border-border-strong focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15 disabled:opacity-60", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label, description }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string; description?: string }) {
  return (
    <label className={cn("flex items-start gap-3", disabled ? "opacity-60" : "cursor-pointer")}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={cn("relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-200", checked ? "bg-primary" : "bg-border-strong")}>
        <span className={cn("absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200", checked && "translate-x-5")} />
      </button>
      {label ? (
        <span className="flex flex-col">
          <span className="text-sm font-medium text-text">{label}</span>
          {description ? <span className="text-[13px] text-text-2">{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; className?: string }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2.5 text-sm", className)}>
      <span onClick={() => onChange(!checked)} role="checkbox" aria-checked={checked} className={cn("flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border transition-colors", checked ? "border-primary bg-primary text-white" : "border-border-strong bg-surface")}>
        {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
      </span>
      {label}
    </label>
  );
}

export function Field({ label, hint, error, children, required }: { label?: string; hint?: string; error?: string | null; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      {label ? (
        <label className="block text-[13px] font-medium text-text">
          {label}
          {required ? <span className="text-danger"> *</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <p className="text-[13px] text-danger">{error}</p> : hint ? <p className="text-[13px] text-text-3">{hint}</p> : null}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search…", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9" />
    </div>
  );
}

/* ───────────────────────────── Surfaces ───────────────────────────── */
export function Card({ className, children, padded = true, ...props }: React.HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return (
    <div className={cn("rounded-card border border-border bg-surface shadow-soft", padded && "p-5 sm:p-6", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-start justify-between gap-3", className)}>
      <div>
        <h3 className="text-[15px] font-semibold text-text">{title}</h3>
        {description ? <p className="mt-0.5 text-[13px] text-text-2">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, crumbs }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; crumbs?: string[] }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 animate-fade-up">
      <div>
        {crumbs?.length ? <div className="mb-1 text-[12px] font-medium uppercase tracking-wider text-text-3">{crumbs.join(" / ")}</div> : null}
        <h1 className="text-[22px] font-semibold tracking-tight text-text sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-text-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "primary" | "success" | "warning" | "danger" | "outline"; className?: string }) {
  const tones = { neutral: "bg-surface-2 text-text-2", primary: "bg-primary-soft text-primary", success: "bg-success-soft text-success", warning: "bg-warning-soft text-warning", danger: "bg-danger-soft text-danger", outline: "border border-border text-text-2" };
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium leading-5 whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function Stat({ label, value, sub, tone, icon }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "primary" | "success" | "warning" | "danger"; icon?: React.ReactNode }) {
  const toneCls = { primary: "text-primary bg-primary-soft", success: "text-success bg-success-soft", warning: "text-warning bg-warning-soft", danger: "text-danger bg-danger-soft" };
  return (
    <Card className="flex items-start justify-between gap-3 p-5">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-text-2">{label}</div>
        <div className="mt-1.5 truncate text-[26px] font-semibold tracking-tight text-text">{value}</div>
        {sub ? <div className="mt-1 text-[12px] text-text-3">{sub}</div> : null}
      </div>
      {icon ? <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-sm", tone ? toneCls[tone] : "bg-surface-2 text-text-2")}>{icon}</div> : null}
    </Card>
  );
}

export function Alert({ tone = "info", title, children, className }: { tone?: "info" | "success" | "warning" | "danger"; title?: string; children?: React.ReactNode; className?: string }) {
  const map = { info: ["bg-primary-soft text-primary", Info], success: ["bg-success-soft text-success", Check], warning: ["bg-warning-soft text-warning", AlertTriangle], danger: ["bg-danger-soft text-danger", AlertTriangle] } as const;
  const [cls, Icon] = map[tone];
  return (
    <div className={cn("flex gap-3 rounded-sm px-4 py-3 text-sm", cls, className)} role="alert">
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="text-text">
        {title ? <div className="font-medium">{title}</div> : null}
        {children ? <div className={cn("text-[13px] text-text-2", title && "mt-0.5")}>{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-card border border-dashed border-border-strong px-6 py-14 text-center", className)}>
      {icon ? <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-text-2">{icon}</div> : null}
      <div className="text-[15px] font-semibold text-text">{title}</div>
      {description ? <p className="mt-1 max-w-sm text-[13px] text-text-2">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4 w-full", className)} />;
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn("h-12", i === 0 && "w-2/3")} />
      ))}
    </div>
  );
}

export function Avatar({ name, src, size = "md", className }: { name: string; src?: string | null; size?: "sm" | "md" | "lg"; className?: string }) {
  const sizes = { sm: "h-7 w-7 text-[11px]", md: "h-9 w-9 text-[13px]", lg: "h-12 w-12 text-base" };
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
  return src ? <img src={src} alt={name} className={cn("rounded-full object-cover", sizes[size], className)} /> : <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-semibold text-primary", sizes[size], className)}>{ini}</span>;
}

/* ───────────────────────────── Dialog / Drawer ───────────────────────────── */
export function Dialog({ open, onClose, title, description, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode; size?: "sm" | "md" | "lg" | "xl" }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={cn("w-full rounded-t-card bg-surface shadow-pop animate-fade-up sm:rounded-card", widths[size])}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <h2 className="text-[16px] font-semibold text-text">{title}</h2>
            {description ? <p className="mt-0.5 text-[13px] text-text-2">{description}</p> : null}
          </div>
          <button onClick={onClose} className="rounded-xs p-1.5 text-text-3 hover:bg-surface-2 hover:text-text" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5 scrollbar-thin">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-border px-6 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = "Confirm", danger, loading, children }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; description?: React.ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean; children?: React.ReactNode }) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description} size="sm" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>{confirmLabel}</Button></>}>
      {children}
    </Dialog>
  );
}

/* ───────────────────────────── Tabs ───────────────────────────── */
export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode; count?: number }[]; className?: string }) {
  return (
    <div className={cn("flex gap-1 overflow-x-auto rounded-sm bg-surface-2 p-1", className)} role="tablist">
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={value === it.value} onClick={() => onChange(it.value)} className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-xs px-3.5 py-1.5 text-[13px] font-medium transition-colors", value === it.value ? "bg-surface text-text shadow-soft" : "text-text-2 hover:text-text")}>
          {it.label}
          {it.count !== undefined ? <span className={cn("rounded-full px-1.5 text-[11px]", value === it.value ? "bg-primary-soft text-primary" : "bg-border text-text-2")}>{it.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────────── Table ───────────────────────────── */
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-card border border-border bg-surface shadow-soft", className)}>
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className, onClick, active, dir }: { children?: React.ReactNode; className?: string; onClick?: () => void; active?: boolean; dir?: "asc" | "desc" }) {
  return (
    <th onClick={onClick} className={cn("border-b border-border bg-surface-2/60 px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-text-2", onClick && "cursor-pointer select-none hover:text-text", className)}>
      <span className="inline-flex items-center gap-1">
        {children}
        {active ? <ChevronDown className={cn("h-3 w-3 transition-transform", dir === "asc" && "rotate-180")} /> : null}
      </span>
    </th>
  );
}
export function Td({ children, className, colSpan, title }: { children?: React.ReactNode; className?: string; colSpan?: number; title?: string }) {
  return <td colSpan={colSpan} title={title} className={cn("border-b border-border px-4 py-3 align-middle text-text last:border-b-0", className)}>{children}</td>;
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 pt-3 text-[13px] text-text-2">
      <span>
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

/* ───────────────────────────── Toast ───────────────────────────── */
type Toast = { id: number; title: string; description?: string; tone: "success" | "danger" | "info" };
const ToastCtx = React.createContext<{ push: (t: Omit<Toast, "id">) => void }>({ push: () => {} });
export function useToast() {
  const { push } = React.useContext(ToastCtx);
  return { success: (title: string, description?: string) => push({ title, description, tone: "success" }), error: (title: string, description?: string) => push({ title, description, tone: "danger" }), info: (title: string, description?: string) => push({ title, description, tone: "info" }) };
}
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = React.useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={cn("pointer-events-auto rounded-sm border bg-surface px-4 py-3 shadow-pop animate-fade-up", t.tone === "success" ? "border-success/30" : t.tone === "danger" ? "border-danger/30" : "border-border")}>
            <div className="flex items-start gap-2.5">
              {t.tone === "success" ? <Check className="mt-0.5 h-4 w-4 text-success" /> : t.tone === "danger" ? <AlertTriangle className="mt-0.5 h-4 w-4 text-danger" /> : <Info className="mt-0.5 h-4 w-4 text-primary" />}
              <div className="min-w-0">
                <div className="text-sm font-medium text-text">{t.title}</div>
                {t.description ? <div className="mt-0.5 text-[13px] text-text-2">{t.description}</div> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ───────────────────────────── Misc ───────────────────────────── */
export function Progress({ value, max, tone = "primary", className }: { value: number; max: number; tone?: "primary" | "success" | "warning" | "danger"; className?: string }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const auto = ratio >= 1 ? "danger" : ratio >= 0.8 ? "warning" : tone;
  const colors = { primary: "bg-primary", success: "bg-success", warning: "bg-warning", danger: "bg-danger" };
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-2", className)}>
      <div className={cn("h-full rounded-full transition-all", colors[auto])} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

export function KeyValue({ items }: { items: { k: React.ReactNode; v: React.ReactNode }[] }) {
  return (
    <dl className="divide-y divide-border text-sm">
      {items.map((it, i) => (
        <div key={i} className="flex justify-between gap-4 py-2.5">
          <dt className="text-text-2">{it.k}</dt>
          <dd className="text-right font-medium text-text">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}
