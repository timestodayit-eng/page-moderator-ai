"use client";
import { Badge, Checkbox, Select } from "@/components/ui";

export const HARMFUL = ["DEFAMATION", "ABUSE", "HARASSMENT", "HATE_SPEECH", "SPAM", "SCAM", "SUSPICIOUS_LINK", "REPEATED_PROMO", "PII_EXPOSURE", "HIGH_RISK"];
export const CATEGORY_LABEL: Record<string, string> = { POSITIVE: "Positive", NEUTRAL: "Neutral", INQUIRY: "Inquiry", SALES_INQUIRY: "Sales inquiry", COMPLAINT: "Complaint", NEGATIVE: "Negative", DEFAMATION: "Defamation / fraud accusation", ABUSE: "Abuse", HARASSMENT: "Harassment", HATE_SPEECH: "Hate speech", SPAM: "Spam", SCAM: "Scam", SUSPICIOUS_LINK: "Suspicious link", REPEATED_PROMO: "Repeated promo", PII_EXPOSURE: "PII exposure", HIGH_RISK: "High risk", UNCERTAIN: "Uncertain" };

export function CategoryBadge({ category }: { category?: string | null }) {
  if (!category) return <Badge>Not analysed</Badge>;
  const tone = HARMFUL.includes(category) ? "danger" : category === "COMPLAINT" || category === "NEGATIVE" ? "warning" : category === "POSITIVE" ? "success" : category === "INQUIRY" || category === "SALES_INQUIRY" ? "primary" : "neutral";
  return <Badge tone={tone}>{CATEGORY_LABEL[category] ?? category}</Badge>;
}

export function DecisionBadge({ decision, autoExecuted, reviewStatus }: { decision?: string; autoExecuted?: boolean; reviewStatus?: string }) {
  if (!decision) return null;
  const tone = decision === "HIDE" ? "danger" : decision === "REPLY" ? "primary" : decision === "REVIEW" ? "warning" : "neutral";
  return <Badge tone={tone}>{decision}{autoExecuted ? " · auto" : reviewStatus === "PENDING" ? " · pending" : reviewStatus === "APPROVED" ? " · approved" : reviewStatus === "REJECTED" ? " · rejected" : ""}</Badge>;
}

export function Confidence({ value }: { value?: number }) {
  if (value === undefined) return null;
  const tone = value >= 0.9 ? "text-success" : value >= 0.7 ? "text-warning" : "text-danger";
  return <span className={`text-[12px] font-medium ${tone}`}>{Math.round(value * 100)}%</span>;
}

export type AlwaysState = { always: boolean; alwaysScope: "PAGE" | "WORKSPACE" };
export const ALWAYS_OFF: AlwaysState = { always: false, alwaysScope: "PAGE" };

/**
 * "Learn this ruling": when ticked, the review action also stores a precedent so the AI applies the same decision to
 * every future comment with the same meaning — on this Page or on all Pages.
 */
export function AlwaysRuling({ value, onChange, decision, compact }: { value: AlwaysState; onChange: (v: AlwaysState) => void; decision: "HIDE" | "KEEP" | "BOTH"; compact?: boolean }) {
  const text = decision === "HIDE" ? "Always hide comments like this from now on" : decision === "KEEP" ? "Never hide comments like this from now on" : "Remember this ruling for comments like this from now on";
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm border border-dashed border-border px-3 py-2 ${compact ? "text-[12px]" : "text-[13px]"}`}>
      <Checkbox checked={value.always} onChange={(v) => onChange({ ...value, always: v })} label={<span>{text} <span className="font-bengali text-text-3">(এই রকম কমেন্ট পরবর্তী সব সময়)</span></span>} />
      {value.always ? (
        <Select value={value.alwaysScope} onChange={(e) => onChange({ ...value, alwaysScope: e.target.value as "PAGE" | "WORKSPACE" })} className="h-8 w-auto text-[12px]">
          <option value="PAGE">on this Page only</option>
          <option value="WORKSPACE">on all Pages</option>
        </Select>
      ) : null}
    </div>
  );
}

export function PrecedentBadge({ precedentId }: { precedentId?: string | null }) {
  if (!precedentId) return null;
  return <Badge tone="primary" className="font-normal">reviewer ruling</Badge>;
}
