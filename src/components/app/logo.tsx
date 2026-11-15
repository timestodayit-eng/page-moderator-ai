import { cn } from "@/lib/utils";

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight text-text", className)}>
      <span className="relative flex h-8 w-8 items-center justify-center rounded-[10px] bg-primary text-white shadow-soft">
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      </span>
      {!compact ? (
        <span className="text-[15px] leading-none">
          Page Moderator <span className="text-primary">AI</span>
        </span>
      ) : null}
    </span>
  );
}
