import type { ConnectedPage, Workspace } from "@/generated/prisma/client";
import { prisma } from "../db";
import { log } from "../log";
import { audit } from "../audit";
import { env } from "../env";
import { recordUsage } from "../billing/usage";
import { AiError } from "../ai/gateway";
import { automationAllowed, requestAction } from "../actions/outbound";
import { parsePageSettings, type PageSettings } from "../meta/pages";
import { HARMFUL_CATEGORIES, POLICY_VERSION, PROTECTED_CATEGORIES, classifyComment, computeSignals, type Category, type Classification } from "./classifier";
import { loadActiveAgent } from "../agents/service";
import { appLink, queueEmail } from "../email/service";

export type Decision = "HIDE" | "REVIEW" | "KEEP" | "REPLY";

type GlobalModerationLimits = { globalMaxAutoHidesPerPagePerHour: number; minAutoHideConfidence: number; autoHideAllowedCategories: string[] };

async function globalLimits(): Promise<GlobalModerationLimits> {
  const row = await prisma.platformSetting.findUnique({ where: { key: "moderation" } });
  return { globalMaxAutoHidesPerPagePerHour: 60, minAutoHideConfidence: 0.85, autoHideAllowedCategories: HARMFUL_CATEGORIES, ...((row?.value as Partial<GlobalModerationLimits>) ?? {}) };
}

/**
 * Policy evaluation: turns a classification into a decision under the Page's mode and the layered limits
 * (global safety floor → Page settings → per-category thresholds → rate limits). Pure except for counts.
 */
export async function evaluatePolicy(page: ConnectedPage, settings: PageSettings, c: Classification, opts: { commentId: string }) {
  const reasons: string[] = [];
  const g = await globalLimits();
  const cat = c.category as Category;
  let decision: Decision = c.recommended_action === "HIDE" ? "REVIEW" : (c.recommended_action as Decision);
  let autoExecute = false;

  if (c.recommended_action === "HIDE") {
    reasons.push(`model recommends HIDE (${cat}, conf ${c.confidence.toFixed(2)}, risk ${c.risk_score.toFixed(2)})`);
    const catCfg = settings.categories[cat];
    if (PROTECTED_CATEGORIES.includes(cat)) {
      reasons.push("protected category — never hidden automatically");
    } else if (page.moderationMode !== "AUTO") {
      reasons.push(`page mode ${page.moderationMode} — queued for human approval`);
    } else if (!page.autoHideEnabled) {
      reasons.push("auto-hide not activated for this Page");
    } else if (!catCfg?.autoHide) {
      reasons.push(`auto-hide disabled for ${cat}`);
    } else if (!g.autoHideAllowedCategories.includes(cat)) {
      reasons.push(`platform policy does not allow auto-hiding ${cat}`);
    } else if (c.confidence < Math.max(catCfg.threshold, g.minAutoHideConfidence)) {
      reasons.push(`confidence ${c.confidence.toFixed(2)} below threshold ${Math.max(catCfg.threshold, g.minAutoHideConfidence)}`);
    } else {
      const hourAgo = new Date(Date.now() - 3_600_000);
      const recentHides = await prisma.moderationAction.count({ where: { type: "HIDE", actorType: "AI", createdAt: { gte: hourAgo }, comment: { pageId: page.id } } });
      const cap = Math.min(settings.maxAutoHidesPerHour, g.globalMaxAutoHidesPerPagePerHour);
      if (recentHides >= cap) reasons.push(`hourly auto-hide cap reached (${recentHides}/${cap})`);
      else {
        decision = "HIDE";
        autoExecute = true;
        reasons.push("all auto-hide conditions satisfied");
      }
    }
    if (!autoExecute) decision = "REVIEW";
  }

  if (c.recommended_action === "REPLY") {
    const canAuto = page.replyMode === "LIMITED_AUTO" && settings.autoReplyCategories.includes(cat) && c.confidence >= settings.replyMinConfidence && Boolean(c.suggested_reply);
    if (page.replyMode === "OFF") {
      decision = "KEEP";
      reasons.push("replies disabled for this Page");
    } else if (canAuto) {
      const hourAgo = new Date(Date.now() - 3_600_000);
      const recent = await prisma.moderationAction.count({ where: { type: "REPLY", actorType: "AI", createdAt: { gte: hourAgo }, comment: { pageId: page.id } } });
      if (recent >= settings.maxAutoRepliesPerHour) {
        decision = "REVIEW";
        reasons.push("hourly auto-reply cap reached");
      } else {
        decision = "REPLY";
        autoExecute = true;
        reasons.push(`limited automatic reply allowed for ${cat}`);
      }
    } else {
      decision = page.replyMode === "SUGGEST" ? "KEEP" : "REVIEW";
      reasons.push(page.replyMode === "SUGGEST" ? "reply suggested for staff" : "reply requires human approval");
    }
  }
  if (page.moderationMode === "SHADOW" && autoExecute) {
    autoExecute = false;
    reasons.push("shadow mode — no changes made on Facebook");
  }
  void opts;
  return { decision, autoExecute, reasons, reviewRequired: decision === "REVIEW" || (decision === "REPLY" && !autoExecute) };
}

/** Full pipeline for one stored comment. Idempotent: a comment that is already ANALYZED is skipped. */
export async function processComment(commentId: string) {
  const claimed = await prisma.comment.updateMany({ where: { id: commentId, status: { in: ["NEW", "FAILED"] } }, data: { status: "ANALYZING" } });
  if (claimed.count === 0) return { skipped: true };
  const comment = await prisma.comment.findUniqueOrThrow({ where: { id: commentId }, include: { page: { include: { workspace: true } } } });
  const page = comment.page;
  const ws = page.workspace;
  try {
    if (page.status === "DISCONNECTED" || ws.status !== "ACTIVE") {
      await prisma.comment.update({ where: { id: commentId }, data: { status: "SKIPPED", lastError: "page disconnected or workspace inactive" } });
      return { skipped: true };
    }
    const services = ws.servicesEnabled as { moderation?: boolean };
    if (services.moderation === false) {
      await prisma.comment.update({ where: { id: commentId }, data: { status: "SKIPPED", lastError: "moderation service disabled" } });
      return { skipped: true };
    }
    const settings = parsePageSettings(page.settings);
    const signals = await computeSignals({ pageId: page.id, fbPageId: page.fbPageId, authorFbId: comment.authorFbId, message: comment.message, fbParentId: comment.fbParentId, createdTime: comment.createdTime, commentId });
    const agent = await loadActiveAgent(ws.id, page.moderationAgentId, "MODERATION");
    const { classification: c, meta, knowledgeUsed } = await classifyComment({ workspaceId: ws.id, pageId: page.id, commentId, message: comment.message, authorName: comment.authorName, signals, agent, businessName: (ws.businessProfile as { displayName?: string })?.displayName ?? ws.name });

    const classification = await prisma.commentClassification.create({
      data: {
        workspaceId: ws.id, commentId, language: c.language, category: c.category, sentiment: c.sentiment, reasoning: c.reasoning, confidence: c.confidence, riskScore: c.risk_score, recommendedAction: c.recommended_action, suggestedReply: c.suggested_reply ?? null,
        signals: { ...signals, intent: c.intent, knowledgeUsed, targetsOtherCommenter: c.targets_other_commenter, containsContactInfo: c.contains_contact_info },
        provider: meta.provider, model: meta.model, agentVersionId: agent?.versionId ?? null, policyVersion: POLICY_VERSION, latencyMs: meta.latencyMs, tokensIn: meta.tokensIn, tokensOut: meta.tokensOut, costMicroUsd: BigInt(meta.costMicroUsd),
      },
    });
    const policy = await evaluatePolicy(page, settings, c, { commentId });
    const decision = await prisma.moderationDecision.create({
      data: { workspaceId: ws.id, commentId, classificationId: classification.id, mode: page.moderationMode, decision: policy.decision, reasons: policy.reasons, autoExecuted: false, reviewStatus: policy.reviewRequired ? "PENDING" : "NOT_REQUIRED" },
    });
    await recordUsage(ws.id, "COMMENTS_PROCESSED", 1, { type: "Comment", id: commentId });

    let executed = false;
    if (policy.autoExecute) {
      const allowed = await automationAllowed(ws.id, page.id, "AI");
      if (allowed.ok) {
        if (policy.decision === "HIDE") {
          await executeHide({ workspaceId: ws.id, page, comment, decisionId: decision.id, actorType: "AI" });
          executed = true;
        } else if (policy.decision === "REPLY" && c.suggested_reply) {
          await executeReply({ workspaceId: ws.id, page, comment, decisionId: decision.id, message: c.suggested_reply, actorType: "AI" });
          executed = true;
        }
      } else {
        await prisma.moderationDecision.update({ where: { id: decision.id }, data: { reasons: { push: `automation blocked: ${allowed.reason}` }, reviewStatus: "PENDING" } });
      }
      if (executed) await prisma.moderationDecision.update({ where: { id: decision.id }, data: { autoExecuted: true } });
    }
    await prisma.comment.update({ where: { id: commentId }, data: { status: "ANALYZED", lastError: null } });
    if ((c.category === "HIGH_RISK" || (c.category === "HARASSMENT" && c.confidence > 0.85)) && settings.notifyOnIncidents) await notifyIncident(ws, page, comment.message, c);
    return { category: c.category, decision: policy.decision, executed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const permanent = err instanceof AiError && (err.code === "BUDGET" || err.code === "NOT_CONFIGURED" || err.code === "INACTIVE" || err.code === "INVALID_KEY");
    await prisma.comment.update({ where: { id: commentId }, data: { status: "FAILED", lastError: message.slice(0, 500) } });
    log.warn("comment processing failed", { commentId, err: message, permanent });
    if (permanent) {
      await notifyAiInterrupted(ws, message);
      return { failed: true, permanent };
    }
    throw err; // transient → BullMQ retries with backoff
  }
}

export async function executeHide(input: { workspaceId: string; page: ConnectedPage; comment: { id: string; fbCommentId: string }; decisionId?: string | null; actorType: "AI" | "USER"; actorUserId?: string | null; note?: string }) {
  const key = input.actorType === "AI" ? `hide:${input.comment.id}:${input.decisionId}` : `hide:${input.comment.id}:u:${input.actorUserId}:${Date.now()}`;
  const { action, created } = await requestAction({ workspaceId: input.workspaceId, pageId: input.page.id, type: "HIDE_COMMENT", targetId: input.comment.fbCommentId, idempotencyKey: key, createdById: input.actorUserId ?? null });
  if (created) await prisma.moderationAction.create({ data: { workspaceId: input.workspaceId, commentId: input.comment.id, type: "HIDE", actorType: input.actorType, actorUserId: input.actorUserId ?? null, decisionId: input.decisionId ?? null, outboundActionId: action.id, status: "REQUESTED", note: input.note } });
  return action;
}

export async function executeUnhide(input: { workspaceId: string; page: ConnectedPage; comment: { id: string; fbCommentId: string }; actorUserId: string; note?: string }) {
  const { action } = await requestAction({ workspaceId: input.workspaceId, pageId: input.page.id, type: "UNHIDE_COMMENT", targetId: input.comment.fbCommentId, idempotencyKey: `unhide:${input.comment.id}:u:${input.actorUserId}:${Date.now()}`, createdById: input.actorUserId });
  await prisma.moderationAction.create({ data: { workspaceId: input.workspaceId, commentId: input.comment.id, type: "UNHIDE", actorType: "USER", actorUserId: input.actorUserId, outboundActionId: action.id, status: "REQUESTED", note: input.note } });
  return action;
}

export async function executeReply(input: { workspaceId: string; page: ConnectedPage; comment: { id: string; fbCommentId: string }; decisionId?: string | null; message: string; actorType: "AI" | "USER"; actorUserId?: string | null }) {
  // One reply per decision for AI; one per explicit human submit.
  const key = input.actorType === "AI" ? `reply:${input.comment.id}:${input.decisionId}` : `reply:${input.comment.id}:u:${input.actorUserId}:${Date.now()}`;
  const { action, created } = await requestAction({ workspaceId: input.workspaceId, pageId: input.page.id, type: "REPLY_COMMENT", targetId: input.comment.fbCommentId, idempotencyKey: key, payload: { message: input.message }, createdById: input.actorUserId ?? null });
  if (created) await prisma.moderationAction.create({ data: { workspaceId: input.workspaceId, commentId: input.comment.id, type: "REPLY", actorType: input.actorType, actorUserId: input.actorUserId ?? null, decisionId: input.decisionId ?? null, outboundActionId: action.id, status: "REQUESTED", note: input.message.slice(0, 500) } });
  return action;
}

async function notifyIncident(ws: Workspace, page: ConnectedPage, text: string, c: Classification) {
  const owners = await prisma.membership.findMany({ where: { workspaceId: ws.id, role: { key: { in: ["owner", "admin", "manager"] } } }, include: { user: true } });
  const summary = `A ${c.category} comment was detected on ${page.name} (confidence ${(c.confidence * 100).toFixed(0)}%): "${text.slice(0, 160)}"`;
  for (const m of owners) {
    await prisma.notification.create({ data: { workspaceId: ws.id, userId: m.userId, type: "MODERATION_INCIDENT", title: `Moderation alert: ${c.category}`, body: summary, link: `/app/${ws.slug}/moderation/review` } });
    if (c.category === "HIGH_RISK") await queueEmail({ to: m.user.email, templateKey: "ops.moderation_incident", workspaceId: ws.id, userId: m.userId, locale: m.user.locale, vars: { name: m.user.name, pageName: page.name, summary, ctaUrl: appLink(`/app/${ws.slug}/moderation/review`) } }).catch(() => {});
  }
}

const interruptedNotified = new Map<string, number>();
async function notifyAiInterrupted(ws: Workspace, reason: string) {
  const last = interruptedNotified.get(ws.id) ?? 0;
  if (Date.now() - last < 6 * 3_600_000) return; // at most once per 6h per workspace per process
  interruptedNotified.set(ws.id, Date.now());
  const owners = await prisma.membership.findMany({ where: { workspaceId: ws.id, role: { key: { in: ["owner", "admin"] } } }, include: { user: true } });
  const isLimit = /budget|limit/i.test(reason);
  for (const m of owners) {
    await prisma.notification.create({ data: { workspaceId: ws.id, userId: m.userId, type: isLimit ? "AI_LIMIT" : "AI_INTERRUPTED", title: isLimit ? "AI usage limit reached" : "AI service interrupted", body: reason.slice(0, 300), link: `/app/${ws.slug}/usage` } });
    await queueEmail({ to: m.user.email, templateKey: isLimit ? "ops.ai_limit_reached" : "ops.ai_interrupted", workspaceId: ws.id, userId: m.userId, locale: m.user.locale, vars: { name: m.user.name, workspaceName: ws.name, reason: reason.slice(0, 300), ctaUrl: appLink(`/app/${ws.slug}/usage`) } }).catch(() => {});
  }
  await audit({ workspaceId: ws.id, actorType: "SYSTEM", action: "ai.interrupted", meta: { reason } });
}

export const moderationConfig = { automationMasterSwitch: () => env().META_AUTOMATION_ENABLED };
