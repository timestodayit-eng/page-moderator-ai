import { z } from "zod";
import { prisma } from "../db";
import { complete, parseJsonObject, type Provider } from "../ai/gateway";
import { retrieveKnowledge } from "../agents/knowledge";
import { loadPrecedents, matchPrecedents, recordHit, type PrecedentLite } from "./precedents";
import type { CompletionResult } from "../ai/gateway";

export const CATEGORIES = [
  "POSITIVE", "NEUTRAL", "INQUIRY", "SALES_INQUIRY", "COMPLAINT", "NEGATIVE", "DEFAMATION", "ABUSE", "HARASSMENT", "HATE_SPEECH", "SPAM", "SCAM", "SUSPICIOUS_LINK", "REPEATED_PROMO", "PII_EXPOSURE", "HIGH_RISK", "UNCERTAIN",
] as const;
export type Category = (typeof CATEGORIES)[number];
export type RecommendedAction = "KEEP" | "REPLY" | "REVIEW" | "HIDE";

export const HARMFUL_CATEGORIES: Category[] = ["DEFAMATION", "ABUSE", "HARASSMENT", "HATE_SPEECH", "SPAM", "SCAM", "SUSPICIOUS_LINK", "REPEATED_PROMO", "PII_EXPOSURE", "HIGH_RISK"];
/** Categories that may NEVER be auto-hidden, regardless of configuration. */
export const PROTECTED_CATEGORIES: Category[] = ["POSITIVE", "NEUTRAL", "INQUIRY", "SALES_INQUIRY", "UNCERTAIN"];
/**
 * Negative-sentiment categories. By default they are only reviewed; a Page admin can switch on
 * `hideNegativeSentiment` so the AI may hide them automatically as well (business decision).
 */
export const NEGATIVE_CATEGORIES: Category[] = ["COMPLAINT", "NEGATIVE"];

export const POLICY_VERSION = "2026.11-r1";

export const classificationSchema = z.object({
  language: z.enum(["bn", "banglish", "en", "mixed", "other"]),
  category: z.enum(CATEGORIES),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  confidence: z.number().min(0).max(1),
  risk_score: z.number().min(0).max(1),
  reasoning: z.string().max(600),
  recommended_action: z.enum(["KEEP", "REPLY", "REVIEW", "HIDE"]),
  intent: z.string().max(200).optional().default(""),
  suggested_reply: z.string().max(1500).nullable().optional(),
  targets_other_commenter: z.boolean().optional().default(false),
  contains_contact_info: z.boolean().optional().default(false),
  negative_vibe: z.boolean().optional().default(false),
  slang_detected: z.boolean().optional().default(false),
  precedent_match: z.string().nullable().optional().default(null),
});
export type Classification = z.infer<typeof classificationSchema>;

export type Signals = {
  urls: string[];
  hasUrl: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  repeatedByAuthor: number; // identical/near-identical comments from the same author on this Page in 24h
  authorCommentsLastHour: number;
  isReply: boolean;
  isPageOwnComment: boolean;
  length: number;
  script: "bengali" | "latin" | "mixed" | "other";
};

const URL_RE = /((https?:\/\/|www\.)[^\s]+|[a-z0-9-]+\.(com|net|org|io|xyz|info|biz|ly|me|co|site|online|shop|bd)(\/[^\s]*)?)/gi;
const PHONE_RE = /(\+?88)?0?1[3-9]\d{2}[-\s]?\d{6}|\+?\d{1,3}[-\s]?\d{3,4}[-\s]?\d{3,4}[-\s]?\d{2,4}/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g;

export function detectScript(text: string): Signals["script"] {
  const bn = (text.match(/[ঀ-৿]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (bn && latin) return bn > latin * 4 ? "bengali" : latin > bn * 4 ? "latin" : "mixed";
  if (bn) return "bengali";
  if (latin) return "latin";
  return "other";
}

export function normalise(text: string) {
  return text.toLowerCase().replace(URL_RE, "<url>").replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

/** Deterministic signals computed from the comment + recent history. Cheap, no AI. */
export async function computeSignals(input: { pageId: string; fbPageId: string; authorFbId?: string | null; message: string; fbParentId?: string | null; createdTime: Date; commentId?: string }): Promise<Signals> {
  const urls = input.message.match(URL_RE) ?? [];
  const since24h = new Date(input.createdTime.getTime() - 86_400_000);
  const since1h = new Date(input.createdTime.getTime() - 3_600_000);
  let repeatedByAuthor = 0;
  let authorCommentsLastHour = 0;
  if (input.authorFbId) {
    const recent = await prisma.comment.findMany({ where: { pageId: input.pageId, authorFbId: input.authorFbId, createdTime: { gte: since24h }, ...(input.commentId ? { id: { not: input.commentId } } : {}) }, select: { message: true, createdTime: true }, take: 50 });
    const norm = normalise(input.message);
    repeatedByAuthor = recent.filter((c) => normalise(c.message) === norm).length;
    authorCommentsLastHour = recent.filter((c) => c.createdTime >= since1h).length;
  }
  return {
    urls,
    hasUrl: urls.length > 0,
    hasPhone: PHONE_RE.test(input.message),
    hasEmail: EMAIL_RE.test(input.message),
    repeatedByAuthor,
    authorCommentsLastHour,
    isReply: Boolean(input.fbParentId && input.fbParentId !== input.fbPageId),
    isPageOwnComment: input.authorFbId === input.fbPageId,
    length: input.message.length,
    script: detectScript(input.message),
  };
}

const SYSTEM_PROMPT = `You are the comment moderation analyst for a business Facebook Page. You read ONE public comment and return a strict JSON object.

You must UNDERSTAND the meaning. The comment may be in Bengali (বাংলা), Banglish (Bengali written in Latin letters, e.g. "apnader service kemon?"), English, or mixed.

Categories (choose exactly one):
- POSITIVE: praise, thanks, satisfaction.
- NEUTRAL: small talk, tagging friends, emojis, unrelated but harmless.
- INQUIRY: question about services, process, documents, timing, location, contact.
- SALES_INQUIRY: wants to buy / apply / asks price, salary, cost, availability.
- COMPLAINT: a specific, legitimate grievance about the business (delay, money, behaviour, quality). Even if angry or rude in tone, if it is about the business it is COMPLAINT, not ABUSE.
- NEGATIVE: general dissatisfaction, distrust or criticism of the business without accusations of crime or insults ("ভালো না", "service slow", "don't recommend"). Also sarcasm and comments whose only purpose is to create a negative vibe about the Page.
- DEFAMATION: calls the business or its people cheats, frauds, thieves or criminals, or claims they ruined someone ("বাটপার", "ঠকবাজ", "প্রতারক", "ধান্দাবাজ", "চোর", "এরা মানুষের টাকা মেরে খায়", "পাসপোর্ট দিয়ে জীবনের সর্বনাশ হয়ে গেল", "সব শেষ করে দিল", "fraud company", "dalal"). Includes Bengali/Banglish slang and insinuations, even without profanity. This is NOT a factual complaint with details — a complaint describes a specific problem; defamation attacks the reputation.
- ABUSE: slurs, obscene insults, severe profanity or vulgar Bengali/Banglish slang directed at the business, its staff or anyone ("তোর মায়েরে…", "শালা", "কুত্তার বাচ্চা", "madarchod", "bokachoda", masked profanity like "b*l", "ch*d").
- HARASSMENT: repeated or targeted attacks on another commenter/individual, threats, intimidation, doxxing attempts.
- HATE_SPEECH: attacks on protected groups (religion, ethnicity, gender, nationality, etc.).
- SPAM: irrelevant promotion, "inbox me", bulk copy-paste marketing, unrelated job/visa offers from third parties.
- SCAM: fraudulent offers, fake agents impersonating the business, requests to send money/phone/passport details to a stranger, "100% guaranteed visa, pay now".
- SUSPICIOUS_LINK: links to unknown/shortened/phishing-looking domains.
- REPEATED_PROMO: same promotional comment posted repeatedly.
- PII_EXPOSURE: comment publicly exposes passport numbers, NID, bank details, or someone else's phone/address.
- HIGH_RISK: self-harm, violence, illegal activity, sexual content involving minors, or anything requiring urgent human attention.
- UNCERTAIN: you genuinely cannot determine meaning (gibberish, ambiguous short text).

Rules:
1. Understand MEANING, tone and slang — never rely on keywords. Bengali and Banglish insults, sarcasm, veiled accusations and "negative vibe" comments must be recognised even when no obvious bad word appears. Distinguish: a specific complaint with facts (COMPLAINT) → a general bad opinion (NEGATIVE) → an accusation of fraud/cheating or ruin without facts (DEFAMATION) → profanity/slurs (ABUSE).
2. Recommend HIDE for DEFAMATION, ABUSE, HARASSMENT, HATE_SPEECH, SPAM, SCAM, SUSPICIOUS_LINK, REPEATED_PROMO, PII_EXPOSURE, HIGH_RISK when confident. For COMPLAINT and NEGATIVE also recommend HIDE when the comment damages the business's reputation without a resolvable issue; the Page's own policy decides whether such hides run automatically or go to review. Set negative_vibe=true for any comment that lowers the Page's reputation in a reader's eyes.
3. Recommend REPLY for INQUIRY, SALES_INQUIRY, POSITIVE, and for COMPLAINT when a calm professional response helps. Recommend REVIEW when a human should look (complaints, uncertain, borderline).
4. confidence = how sure you are about the category. risk_score = potential harm to the community/business if the comment stays visible (0 = none, 1 = severe).
5. If recommended_action is REPLY and business knowledge is provided, write suggested_reply in the SAME language/script as the comment, warm and professional, 1-3 sentences, never inventing prices, salaries, dates or guarantees. If the needed fact is not in the knowledge, politely direct them to the official contact instead. Otherwise set suggested_reply to null.
6. Keep reasoning short (one or two sentences, English).
7. Reviewer rulings: the business's reviewers may have ruled on earlier comments ("ALWAYS hide comments like this" / "NEVER hide comments like this"). These rulings are BINDING and override your own judgement. If the new comment carries the same meaning, accusation, topic or intent as a ruling — even with different wording, spelling, language or script — set precedent_match to that ruling's id and follow its decision (HIDE → recommended_action HIDE; KEEP → never HIDE). If no ruling applies, set precedent_match to null. Never invent ids.

Return ONLY JSON with keys: language, category, sentiment, confidence, risk_score, reasoning, recommended_action, intent, suggested_reply, targets_other_commenter, contains_contact_info, negative_vibe, slang_detected, precedent_match.`;

export type ClassifyInput = {
  workspaceId: string;
  pageId: string;
  commentId?: string;
  message: string;
  authorName?: string | null;
  postContext?: string | null;
  signals: Signals;
  agent?: { id: string; versionId: string; instructions: string; provider: Provider; model: string; credentialId?: string | null; temperature: number; languages: string[]; tone: string; safetyRules: string; knowledgeSourceIds: string[] } | null;
  businessName: string;
  /** Page owner's plain-language moderation instructions (settings.moderationGuidance). */
  guidance?: string | null;
  purpose?: "CLASSIFY" | "EVAL" | "TEST";
};

export type ClassifyMeta = Omit<CompletionResult, "provider"> & { provider: CompletionResult["provider"] | "precedent" };
export type ClassifyOutput = { classification: Classification; meta: ClassifyMeta; knowledgeUsed: number; precedent: { id: string; decision: "HIDE" | "KEEP"; how: "EXACT" | "SEMANTIC" } | null };

function fromPrecedent(p: PrecedentLite, s: Signals): Classification {
  const hide = p.decision === "HIDE";
  return {
    language: s.script === "bengali" ? "bn" : s.script === "latin" ? "en" : s.script === "mixed" ? "mixed" : "other",
    category: p.category as Category,
    sentiment: hide ? "negative" : "neutral",
    confidence: 0.99,
    risk_score: hide ? 0.9 : 0.05,
    reasoning: `Matches a reviewer ruling (${hide ? "always hide" : "never hide"} comments like this)${p.note ? `: ${p.note.slice(0, 160)}` : "."}`,
    recommended_action: hide ? "HIDE" : "KEEP",
    intent: hide ? "reputation-damaging (per reviewer ruling)" : "acceptable (per reviewer ruling)",
    suggested_reply: null,
    targets_other_commenter: false,
    contains_contact_info: s.hasPhone || s.hasEmail,
    negative_vibe: hide,
    slang_detected: false,
    precedent_match: p.id,
  };
}

export async function classifyComment(input: ClassifyInput): Promise<ClassifyOutput> {
  // 1) Reviewer precedents: exact / near-exact text applies the ruling without spending an AI call.
  const precedents = await loadPrecedents(input.workspaceId, input.pageId);
  const match = matchPrecedents(input.message, precedents);
  if (match.exact) {
    await recordHit(match.exact.id);
    const c = applyDeterministicRules(fromPrecedent(match.exact, input.signals), input.signals, { precedent: true });
    return { classification: c, meta: { text: "", tokensIn: 0, tokensOut: 0, model: "precedent", provider: "precedent", latencyMs: 0, costMicroUsd: 0 }, knowledgeUsed: 0, precedent: { id: match.exact.id, decision: match.exact.decision, how: "EXACT" } };
  }
  const candidateById = new Map(match.candidates.map((c) => [c.precedent.id, c.precedent]));

  const knowledge = input.agent?.knowledgeSourceIds?.length ? await retrieveKnowledge(input.workspaceId, input.message, { sourceIds: input.agent.knowledgeSourceIds, limit: 5 }) : await retrieveKnowledge(input.workspaceId, input.message, { limit: 4 });
  const examples = await prisma.trainingExample.findMany({ where: { workspaceId: input.workspaceId, kind: "MODERATION", status: "ACTIVE", ...(input.agent ? { OR: [{ agentId: input.agent.id }, { agentId: null }] } : {}) }, orderBy: { updatedAt: "desc" }, take: 12, select: { text: true, category: true, expectedDecision: true, explanation: true } });

  const sys = [
    SYSTEM_PROMPT,
    `Business: ${input.businessName}.`,
    input.agent?.instructions ? `Business-specific instructions:\n${input.agent.instructions}` : "",
    input.guidance?.trim() ? `Page owner's moderation instructions (binding — they define what counts as negative or acceptable for THIS business):\n${input.guidance.trim().slice(0, 4000)}` : "",
    input.agent?.safetyRules ? `Additional safety rules:\n${input.agent.safetyRules}` : "",
    input.agent?.tone ? `Reply tone: ${input.agent.tone}.` : "",
    knowledge.length ? `Approved business knowledge (use ONLY this for facts in replies):\n${knowledge.map((k, i) => `[${i + 1}] ${k.content}`).join("\n")}` : "No business knowledge available: never state prices, salaries or guarantees in replies.",
    examples.length ? `Labelled examples from this business's reviewers:\n${examples.map((e) => `- "${e.text.slice(0, 200)}" → ${e.category}${e.expectedDecision ? ` / ${e.expectedDecision}` : ""}${e.explanation ? ` (${e.explanation.slice(0, 120)})` : ""}`).join("\n")}` : "",
    match.candidates.length
      ? `Reviewer rulings (BINDING — see rule 7). Each line: id | decision | scope | the comment that was ruled on:\n${match.candidates.map((c) => `- ${c.precedent.id} | ${c.precedent.decision === "HIDE" ? "ALWAYS HIDE" : "NEVER HIDE"} | ${c.precedent.pageId ? "this Page" : "all Pages"} | "${c.precedent.text.slice(0, 220)}"${c.precedent.note ? ` (reviewer note: ${c.precedent.note.slice(0, 100)})` : ""}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const s = input.signals;
  const user = `Comment${input.authorName ? ` by "${input.authorName}"` : ""}${s.isReply ? " (a reply to another comment)" : ""}:\n"""${input.message.slice(0, 2000)}"""\n\nDeterministic signals: urls=${s.urls.length}, phone=${s.hasPhone}, email=${s.hasEmail}, identical_comments_by_same_author_24h=${s.repeatedByAuthor}, author_comments_last_hour=${s.authorCommentsLastHour}, script=${s.script}${input.postContext ? `\nPost context: ${input.postContext.slice(0, 400)}` : ""}`;

  const result = await complete({
    workspaceId: input.workspaceId,
    purpose: input.purpose ?? "CLASSIFY",
    provider: input.agent?.provider,
    credentialId: input.agent?.credentialId,
    model: input.agent?.model,
    temperature: input.agent?.temperature ?? 0.1,
    maxTokens: 700,
    json: true,
    agentId: input.agent?.id,
    agentVersionId: input.agent?.versionId,
    ref: input.commentId ? { type: "Comment", id: input.commentId } : undefined,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });
  const raw = parseJsonObject<unknown>(result.text);
  const parsed = classificationSchema.safeParse(raw);
  let classification: Classification = parsed.success
    ? parsed.data
    : { language: "other", category: "UNCERTAIN", sentiment: "neutral", confidence: 0.3, risk_score: 0.2, reasoning: "Model output failed validation; routed to human review.", recommended_action: "REVIEW", intent: "", suggested_reply: null, targets_other_commenter: false, contains_contact_info: false, negative_vibe: false, slang_detected: false, precedent_match: null };

  // 2) Semantic precedent: the model recognised the same meaning as an earlier ruling.
  const matched = classification.precedent_match ? candidateById.get(classification.precedent_match) : undefined;
  if (matched) {
    await recordHit(matched.id);
    if (matched.decision === "HIDE") {
      classification = { ...classification, category: HARMFUL_CATEGORIES.includes(classification.category) ? classification.category : (matched.category as Category), recommended_action: "HIDE", confidence: Math.max(classification.confidence, 0.92), risk_score: Math.max(classification.risk_score, 0.8), negative_vibe: true, reasoning: `${classification.reasoning} Matches reviewer ruling (always hide comments like this).` };
    } else {
      classification = { ...classification, recommended_action: classification.recommended_action === "REPLY" ? "REPLY" : "KEEP", risk_score: Math.min(classification.risk_score, 0.2), reasoning: `${classification.reasoning} Matches reviewer ruling (never hide comments like this).` };
    }
  } else {
    classification = { ...classification, precedent_match: null };
  }
  return { classification: applyDeterministicRules(classification, s, { precedent: Boolean(matched) }), meta: result, knowledgeUsed: knowledge.length, precedent: matched ? { id: matched.id, decision: matched.decision, how: "SEMANTIC" } : null };
}

/**
 * Deterministic safety layer on top of the model output:
 *  - protected categories can never carry a HIDE recommendation
 *  - strong spam/scam signals raise risk; a single harmless URL from a first-time commenter does not
 *  - repeated identical promotional text → REPEATED_PROMO
 *  - low confidence → UNCERTAIN/REVIEW
 */
export function applyDeterministicRules(c: Classification, s: Signals, opts: { precedent?: boolean } = {}): Classification {
  const out = { ...c };
  if (s.isPageOwnComment) return { ...out, category: out.category === "UNCERTAIN" ? "NEUTRAL" : out.category, recommended_action: "KEEP", risk_score: 0, reasoning: `${out.reasoning} Comment is from the Page itself.` };
  if (opts.precedent) {
    // A reviewer ruling is final: only the Page-own-comment guard above and the protected-category guard apply.
    if (PROTECTED_CATEGORIES.includes(out.category) && out.recommended_action === "HIDE") out.category = "NEGATIVE";
    return out;
  }
  if (s.repeatedByAuthor >= 2 && (out.category === "SPAM" || out.category === "SCAM" || out.category === "SUSPICIOUS_LINK" || (s.hasUrl && out.category !== "COMPLAINT" && out.category !== "INQUIRY"))) {
    out.category = "REPEATED_PROMO";
    out.recommended_action = "HIDE";
    out.confidence = Math.max(out.confidence, 0.9);
    out.risk_score = Math.max(out.risk_score, 0.7);
  }
  if (out.category === "SCAM" || out.category === "SUSPICIOUS_LINK") out.risk_score = Math.max(out.risk_score, 0.75);
  if (s.hasUrl && (out.category === "SPAM" || out.category === "SCAM")) out.confidence = Math.min(1, out.confidence + 0.05);
  if (out.confidence < 0.55 && HARMFUL_CATEGORIES.includes(out.category)) {
    out.category = "UNCERTAIN";
    out.recommended_action = "REVIEW";
  }
  if (PROTECTED_CATEGORIES.includes(out.category) && out.recommended_action === "HIDE") out.recommended_action = "KEEP";
  // Negative sentiment: the model may recommend HIDE; the policy engine decides whether it executes automatically.
  if (NEGATIVE_CATEGORIES.includes(out.category) && out.recommended_action === "HIDE" && out.confidence < 0.7) out.recommended_action = "REVIEW";
  if (out.negative_vibe && (out.category === "NEUTRAL" || out.category === "POSITIVE")) out.category = "NEGATIVE";
  if (out.category === "HIGH_RISK") out.recommended_action = "REVIEW"; // humans decide on high-risk content; may hide via policy only when explicitly enabled
  if (out.recommended_action === "REPLY" && !out.suggested_reply) out.recommended_action = out.category === "COMPLAINT" ? "REVIEW" : "KEEP";
  return out;
}
