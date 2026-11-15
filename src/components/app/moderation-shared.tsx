"use client";
import { Badge } from "@/components/ui";

export const HARMFUL = ["ABUSE", "HARASSMENT", "HATE_SPEECH", "SPAM", "SCAM", "SUSPICIOUS_LINK", "REPEATED_PROMO", "PII_EXPOSURE", "HIGH_RISK"];
export const CATEGORY_LABEL: Record<string, string> = { POSITIVE: "Positive", NEUTRAL: "Neutral", INQUIRY: "Inquiry", SALES_INQUIRY: "Sales inquiry", COMPLAINT: "Complaint", NEGATIVE: "Negative", ABUSE: "Abuse", HARASSMENT: "Harassment", HATE_SPEECH: "Hate speech", SPAM: "Spam", SCAM: "Scam", SUSPICIOUS_LINK: "Suspicious link", REPEATED_PROMO: "Repeated promo", PII_EXPOSURE: "PII exposure", HIGH_RISK: "High risk", UNCERTAIN: "Uncertain" };

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
