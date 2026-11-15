import { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db";
import { Errors } from "../errors";
import { audit } from "../audit";
import type { WorkspaceContext } from "../rbac/guard";
import { executeHide, executeReply, executeUnhide } from "./engine";
import { CATEGORIES, type Category } from "./classifier";
import { enqueueOutbox } from "../queue/outbox";

type Meta = { ip?: string | null };

export async function listComments(workspaceId: string, q: { pageId?: string; category?: string; status?: string; review?: "PENDING" | "APPROVED" | "REJECTED"; hidden?: boolean; search?: string; from?: Date; to?: Date; skip: number; take: number }) {
  const where: Prisma.CommentWhereInput = {
    workspaceId,
    ...(q.pageId ? { pageId: q.pageId } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.hidden !== undefined ? { isHidden: q.hidden } : {}),
    ...(q.search ? { OR: [{ message: { contains: q.search, mode: "insensitive" } }, { authorName: { contains: q.search, mode: "insensitive" } }] } : {}),
    ...(q.from || q.to ? { createdTime: { gte: q.from, lte: q.to } } : {}),
    ...(q.category ? { classifications: { some: { category: q.category } } } : {}),
    ...(q.review ? { decisions: { some: { reviewStatus: q.review } } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.comment.count({ where }),
    prisma.comment.findMany({
      where,
      skip: q.skip,
      take: q.take,
      orderBy: { createdTime: "desc" },
      include: {
        page: { select: { id: true, name: true, pictureUrl: true } },
        classifications: { orderBy: { createdAt: "desc" }, take: 1 },
        decisions: { orderBy: { createdAt: "desc" }, take: 1 },
        actions: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    }),
  ]);
  return { total, rows: rows.map((r) => ({ ...r, classifications: r.classifications.map((c) => ({ ...c, costMicroUsd: Number(c.costMicroUsd) })) })) };
}

export async function commentDetail(workspaceId: string, commentId: string) {
  const c = await prisma.comment.findFirst({ where: { id: commentId, workspaceId }, include: { page: true, classifications: { orderBy: { createdAt: "desc" } }, decisions: { orderBy: { createdAt: "desc" } }, actions: { orderBy: { createdAt: "desc" } } } });
  if (!c) throw Errors.notFound("Comment");
  const actionIds = c.actions.map((a) => a.outboundActionId).filter(Boolean) as string[];
  const outbound = await prisma.outboundAction.findMany({ where: { id: { in: actionIds } }, select: { id: true, status: true, attempts: true, lastError: true, externalId: true, completedAt: true } });
  const history = c.authorFbId ? await prisma.comment.count({ where: { pageId: c.pageId, authorFbId: c.authorFbId } }) : 0;
  return { ...c, classifications: c.classifications.map((x) => ({ ...x, costMicroUsd: Number(x.costMicroUsd) })), outbound, authorCommentCount: history };
}

async function loadCommentForAction(ctx: WorkspaceContext, commentId: string) {
  const c = await prisma.comment.findFirst({ where: { id: commentId, workspaceId: ctx.workspace.id }, include: { page: true, decisions: { where: { reviewStatus: "PENDING" }, orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!c) throw Errors.notFound("Comment");
  if (c.page.status !== "CONNECTED") throw Errors.conflict("This Page is not connected; reconnect it before taking actions");
  return c;
}

export async function hideComment(ctx: WorkspaceContext, commentId: string, note: string | undefined, meta: Meta) {
  const c = await loadCommentForAction(ctx, commentId);
  if (c.isHidden) throw Errors.conflict("Comment is already hidden");
  const action = await executeHide({ workspaceId: ctx.workspace.id, page: c.page, comment: c, decisionId: c.decisions[0]?.id ?? null, actorType: "USER", actorUserId: ctx.user.id, note });
  if (c.decisions[0]) await prisma.moderationDecision.update({ where: { id: c.decisions[0].id }, data: { reviewStatus: "APPROVED", reviewedById: ctx.user.id, reviewedAt: new Date(), reviewNote: note } });
  await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "comment.hide_requested", targetType: "Comment", targetId: commentId, ip: meta.ip, meta: { note } });
  return { actionId: action.id, status: action.status };
}

export async function unhideComment(ctx: WorkspaceContext, commentId: string, note: string | undefined, meta: Meta) {
  const c = await loadCommentForAction(ctx, commentId);
  const action = await executeUnhide({ workspaceId: ctx.workspace.id, page: c.page, comment: c, actorUserId: ctx.user.id, note });
  // Unhiding an AI-hidden comment is a false-positive signal unless the reviewer says otherwise.
  const aiHide = await prisma.moderationAction.findFirst({ where: { commentId, type: "HIDE", actorType: "AI" }, orderBy: { createdAt: "desc" } });
  if (aiHide?.decisionId) await prisma.moderationDecision.update({ where: { id: aiHide.decisionId }, data: { feedback: "FALSE_POSITIVE", reviewedById: ctx.user.id, reviewedAt: new Date(), reviewNote: note } }).catch(() => {});
  await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "comment.unhide_requested", targetType: "Comment", targetId: commentId, ip: meta.ip, meta: { note, wasAiHidden: Boolean(aiHide) } });
  return { actionId: action.id, status: action.status };
}

export async function replyToComment(ctx: WorkspaceContext, commentId: string, message: string, meta: Meta) {
  const c = await loadCommentForAction(ctx, commentId);
  if (!message.trim()) throw Errors.badRequest("Reply cannot be empty");
  const action = await executeReply({ workspaceId: ctx.workspace.id, page: c.page, comment: c, decisionId: c.decisions[0]?.id ?? null, message: message.trim(), actorType: "USER", actorUserId: ctx.user.id });
  if (c.decisions[0]) await prisma.moderationDecision.update({ where: { id: c.decisions[0].id }, data: { reviewStatus: "APPROVED", reviewedById: ctx.user.id, reviewedAt: new Date() } });
  await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "comment.reply_requested", targetType: "Comment", targetId: commentId, ip: meta.ip });
  return { actionId: action.id, status: action.status };
}

/**
 * Review an AI decision: approve (execute the recommended hide/reply), reject (keep), with optional feedback
 * labels and category correction which become training examples.
 */
export async function reviewDecision(ctx: WorkspaceContext, decisionId: string, input: { outcome: "APPROVE" | "REJECT"; note?: string; feedback?: "CORRECT" | "FALSE_POSITIVE" | "FALSE_NEGATIVE" | "WRONG_CATEGORY"; correctedCategory?: string; editedReply?: string; saveAsExample?: boolean }, meta: Meta) {
  const d = await prisma.moderationDecision.findFirst({ where: { id: decisionId, workspaceId: ctx.workspace.id }, include: { comment: { include: { page: true, classifications: { orderBy: { createdAt: "desc" }, take: 1 } } } } });
  if (!d) throw Errors.notFound("Decision");
  if (d.reviewStatus !== "PENDING") throw Errors.conflict("This decision has already been reviewed");
  if (input.correctedCategory && !(CATEGORIES as readonly string[]).includes(input.correctedCategory)) throw Errors.badRequest("Unknown category");
  const cls = d.comment.classifications[0];
  let actionId: string | null = null;
  if (input.outcome === "APPROVE") {
    if (d.comment.page.status !== "CONNECTED") throw Errors.conflict("Page not connected");
    if (d.decision === "HIDE") actionId = (await executeHide({ workspaceId: ctx.workspace.id, page: d.comment.page, comment: d.comment, decisionId: d.id, actorType: "USER", actorUserId: ctx.user.id, note: input.note })).id;
    else if (d.decision === "REPLY" || input.editedReply) {
      const text = (input.editedReply ?? cls?.suggestedReply ?? "").trim();
      if (!text) throw Errors.badRequest("No reply text available");
      actionId = (await executeReply({ workspaceId: ctx.workspace.id, page: d.comment.page, comment: d.comment, decisionId: d.id, message: text, actorType: "USER", actorUserId: ctx.user.id })).id;
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.moderationDecision.update({ where: { id: d.id }, data: { reviewStatus: input.outcome === "APPROVE" ? "APPROVED" : "REJECTED", reviewedById: ctx.user.id, reviewedAt: new Date(), reviewNote: input.note, feedback: input.feedback ?? (input.outcome === "APPROVE" ? "CORRECT" : d.decision === "HIDE" ? "FALSE_POSITIVE" : null), correctedCategory: input.correctedCategory } });
    if (input.saveAsExample || input.correctedCategory || input.editedReply) {
      await tx.trainingExample.create({
        data: {
          workspaceId: ctx.workspace.id,
          agentId: d.comment.page.moderationAgentId,
          kind: input.editedReply ? "REPLY" : "MODERATION",
          text: d.comment.message,
          language: cls?.language ?? "bn",
          category: (input.correctedCategory as Category | undefined) ?? cls?.category ?? null,
          expectedDecision: input.outcome === "APPROVE" ? d.decision : "KEEP",
          expectedReply: input.editedReply ?? null,
          explanation: input.note ?? "",
          source: "FEEDBACK",
          createdById: ctx.user.id,
        },
      });
    }
    await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: `moderation.decision_${input.outcome.toLowerCase()}d`, targetType: "ModerationDecision", targetId: d.id, ip: meta.ip, meta: { decision: d.decision, feedback: input.feedback, correctedCategory: input.correctedCategory } }, tx);
  });
  return { actionId };
}

export async function bulkReview(ctx: WorkspaceContext, decisionIds: string[], outcome: "APPROVE" | "REJECT", meta: Meta) {
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of decisionIds.slice(0, 50)) {
    try {
      await reviewDecision(ctx, id, { outcome }, meta);
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

export async function reanalyze(ctx: WorkspaceContext, commentId: string) {
  const c = await prisma.comment.findFirst({ where: { id: commentId, workspaceId: ctx.workspace.id } });
  if (!c) throw Errors.notFound("Comment");
  await prisma.$transaction(async (tx) => {
    // Older pending decisions are superseded by the fresh analysis.
    await tx.moderationDecision.updateMany({ where: { commentId, reviewStatus: "PENDING" }, data: { reviewStatus: "NOT_REQUIRED", reviewNote: "Superseded by re-analysis" } });
    await tx.comment.update({ where: { id: commentId }, data: { status: "NEW" } });
    await enqueueOutbox("moderation.process", { commentId }, tx);
  });
}

export async function moderationStats(workspaceId: string, pageId?: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const pageFilter = pageId ? { pageId } : {};
  const [total, byCategory, hiddenAuto, pending, overrides, falsePositives, aiHides, daily] = await Promise.all([
    prisma.comment.count({ where: { workspaceId, receivedAt: { gte: since }, ...pageFilter } }),
    prisma.commentClassification.groupBy({ by: ["category"], _count: true, where: { workspaceId, createdAt: { gte: since }, comment: pageFilter } }),
    prisma.moderationAction.count({ where: { workspaceId, type: "HIDE", actorType: "AI", status: "SUCCEEDED", createdAt: { gte: since }, comment: pageFilter } }),
    prisma.moderationDecision.count({ where: { workspaceId, reviewStatus: "PENDING", comment: pageFilter } }),
    prisma.moderationDecision.count({ where: { workspaceId, reviewStatus: "REJECTED", createdAt: { gte: since }, comment: pageFilter } }),
    prisma.moderationDecision.count({ where: { workspaceId, feedback: "FALSE_POSITIVE", createdAt: { gte: since }, comment: pageFilter } }),
    prisma.moderationDecision.count({ where: { workspaceId, decision: "HIDE", createdAt: { gte: since }, comment: pageFilter } }),
    prisma.$queryRaw<{ day: Date; total: number; hidden: number; harmful: number }[]>`
      SELECT date_trunc('day', c."receivedAt") AS day, COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE c."isHidden")::int AS hidden,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "CommentClassification" k WHERE k."commentId" = c."id" AND k."category" IN ('ABUSE','HARASSMENT','HATE_SPEECH','SPAM','SCAM','SUSPICIOUS_LINK','REPEATED_PROMO','PII_EXPOSURE','HIGH_RISK')))::int AS harmful
      FROM "Comment" c WHERE c."workspaceId" = ${workspaceId} AND c."receivedAt" >= ${since} ${pageId ? Prisma.sql`AND c."pageId" = ${pageId}` : Prisma.empty}
      GROUP BY 1 ORDER BY 1`,
  ]);
  const cat = Object.fromEntries(byCategory.map((b) => [b.category, b._count]));
  return {
    total,
    categories: cat,
    positive: cat.POSITIVE ?? 0,
    negative: (cat.NEGATIVE ?? 0) + (cat.COMPLAINT ?? 0),
    complaints: cat.COMPLAINT ?? 0,
    spam: (cat.SPAM ?? 0) + (cat.SCAM ?? 0) + (cat.SUSPICIOUS_LINK ?? 0) + (cat.REPEATED_PROMO ?? 0),
    harmful: (cat.ABUSE ?? 0) + (cat.HARASSMENT ?? 0) + (cat.HATE_SPEECH ?? 0) + (cat.HIGH_RISK ?? 0),
    autoHidden: hiddenAuto,
    awaitingReview: pending,
    manualOverrides: overrides,
    falsePositiveRate: aiHides ? falsePositives / aiHides : 0,
    daily: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), total: d.total, hidden: d.hidden, harmful: d.harmful })),
  };
}

