import { describe, expect, it } from "vitest";
import { applyDeterministicRules, detectScript, normalise, type Classification, type Signals } from "@/server/moderation/classifier";
import { computeMetrics } from "@/server/agents/evaluation";
import { readFileSync } from "node:fs";

const base: Signals = { urls: [], hasUrl: false, hasPhone: false, hasEmail: false, repeatedByAuthor: 0, authorCommentsLastHour: 0, isReply: false, isPageOwnComment: false, length: 20, script: "bengali" };
const c = (o: Partial<Classification>): Classification => ({ language: "bn", category: "NEUTRAL", sentiment: "neutral", confidence: 0.9, risk_score: 0.1, reasoning: "", recommended_action: "KEEP", intent: "", suggested_reply: null, targets_other_commenter: false, contains_contact_info: false, negative_vibe: false, slang_detected: false, ...o });

describe("deterministic safety rules", () => {
  it("never allows HIDE for protected categories; negative sentiment may be HIDE (policy decides execution)", () => {
    for (const cat of ["POSITIVE", "INQUIRY", "SALES_INQUIRY", "NEUTRAL", "UNCERTAIN"] as const) {
      const out = applyDeterministicRules(c({ category: cat, recommended_action: "HIDE", confidence: 0.99 }), base);
      expect(out.recommended_action, cat).not.toBe("HIDE");
    }
    expect(applyDeterministicRules(c({ category: "COMPLAINT", recommended_action: "HIDE", confidence: 0.9 }), base).recommended_action).toBe("HIDE");
    expect(applyDeterministicRules(c({ category: "NEGATIVE", recommended_action: "HIDE", confidence: 0.6 }), base).recommended_action).toBe("REVIEW");
    expect(applyDeterministicRules(c({ category: "DEFAMATION", recommended_action: "HIDE", confidence: 0.9 }), base).recommended_action).toBe("HIDE");
  });
  it("negative vibe on a neutral-looking comment becomes NEGATIVE", () => {
    expect(applyDeterministicRules(c({ category: "NEUTRAL", negative_vibe: true }), base).category).toBe("NEGATIVE");
  });
  it("downgrades low-confidence harmful labels to UNCERTAIN/REVIEW", () => {
    const out = applyDeterministicRules(c({ category: "ABUSE", recommended_action: "HIDE", confidence: 0.5 }), base);
    expect(out.category).toBe("UNCERTAIN");
    expect(out.recommended_action).toBe("REVIEW");
  });
  it("escalates repeated promotional text to REPEATED_PROMO", () => {
    const out = applyDeterministicRules(c({ category: "SPAM", recommended_action: "REVIEW", confidence: 0.7 }), { ...base, hasUrl: true, repeatedByAuthor: 3 });
    expect(out.category).toBe("REPEATED_PROMO");
    expect(out.recommended_action).toBe("HIDE");
    expect(out.confidence).toBeGreaterThanOrEqual(0.9);
  });
  it("keeps the Page's own comments and forces HIGH_RISK to human review", () => {
    expect(applyDeterministicRules(c({ category: "SPAM", recommended_action: "HIDE" }), { ...base, isPageOwnComment: true }).recommended_action).toBe("KEEP");
    expect(applyDeterministicRules(c({ category: "HIGH_RISK", recommended_action: "HIDE", confidence: 0.99 }), base).recommended_action).toBe("REVIEW");
  });
  it("REPLY without text falls back to KEEP (or REVIEW for complaints)", () => {
    expect(applyDeterministicRules(c({ category: "INQUIRY", recommended_action: "REPLY" }), base).recommended_action).toBe("KEEP");
    expect(applyDeterministicRules(c({ category: "COMPLAINT", recommended_action: "REPLY" }), base).recommended_action).toBe("REVIEW");
  });
  it("script detection & normalisation", () => {
    expect(detectScript("আপনাদের সার্ভিস")).toBe("bengali");
    expect(detectScript("apnader service")).toBe("latin");
    expect(detectScript("ভাই salary koto?")).toBe("mixed");
    expect(normalise("Visit www.scam.xyz now 100%")).toBe(normalise("visit www.other.com now 50%"));
  });
});

describe("evaluation metrics", () => {
  it("computes precision/recall, hide FP rate and complaint preservation on the dataset shape", () => {
    const dataset = JSON.parse(readFileSync("tests/fixtures/moderation-dataset.json", "utf8")) as { category: string; expectedDecision: string }[];
    expect(dataset.length).toBeGreaterThanOrEqual(25);
    const perfect = dataset.map((d) => ({ expected: d.category, predicted: d.category, expectedDecision: d.expectedDecision, predictedAction: d.expectedDecision, correct: true }));
    const m = computeMetrics(perfect);
    expect(m.accuracy).toBe(1);
    expect(m.hide.falsePositiveRate).toBe(0);
    expect(m.complaintPreserved).toBe(1);
    const bad = perfect.map((d) => (d.expected === "COMPLAINT" ? { ...d, predicted: "ABUSE", predictedAction: "HIDE", correct: false } : d));
    const m2 = computeMetrics(bad);
    expect(m2.complaintPreserved).toBeLessThan(1);
    expect(m2.hide.falsePositiveRate).toBeGreaterThan(0);
    expect(m2.perCategory.ABUSE.precision).toBeLessThan(1);
  });
});
