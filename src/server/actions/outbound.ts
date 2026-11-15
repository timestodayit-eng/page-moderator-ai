import type { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "../db";
import { env } from "../env";
import { log } from "../log";
import { audit } from "../audit";
import { enqueueOutbox } from "../queue/outbox";
import { graph, GraphError } from "../meta/graph";
import { markPageTokenInvalid, pageToken } from "../meta/pages";
import { recordUsage } from "../billing/usage";

export type OutboundType = "HIDE_COMMENT" | "UNHIDE_COMMENT" | "REPLY_COMMENT" | "SEND_MESSAGE";

/**
 * Create an outbound action (one external side effect). Idempotency key makes duplicates impossible:
 * e.g. `reply:<commentId>:<decisionId>` means an AI decision can produce at most one reply, ever.
 */
export async function requestAction(input: { workspaceId: string; pageId: string; type: OutboundType; targetId: string; idempotencyKey: string; payload?: Record<string, unknown>; createdById?: string | null; actorType?: "AI" | "USER" }, tx: Tx = prisma) {
  const existing = await tx.outboundAction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return { action: existing, created: false };
  const action = await tx.outboundAction.create({
    data: { workspaceId: input.workspaceId, pageId: input.pageId, type: input.type, targetId: input.targetId, idempotencyKey: input.idempotencyKey, payload: (input.payload ?? {}) as Prisma.InputJsonValue, createdById: input.createdById ?? null },
  });
  await enqueueOutbox("outbound.execute", { actionId: action.id }, tx);
  return { action, created: true };
}

/** Global + per-workspace guards evaluated right before any automated Meta write. */
export async function automationAllowed(workspaceId: string, pageId: string | null, actorType: "AI" | "USER") {
  if (actorType === "USER") return { ok: true as const };
  if (!env().META_AUTOMATION_ENABLED) return { ok: false as const, reason: "META_AUTOMATION_ENABLED is false (global master switch)" };
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { status: true, emergencyPause: true } });
  if (!ws || ws.status !== "ACTIVE") return { ok: false as const, reason: "workspace not active" };
  if (ws.emergencyPause) return { ok: false as const, reason: "workspace emergency pause" };
  if (pageId) {
    const page = await prisma.connectedPage.findUnique({ where: { id: pageId }, select: { killSwitch: true, status: true } });
    if (!page || page.status !== "CONNECTED") return { ok: false as const, reason: "page not connected" };
    if (page.killSwitch) return { ok: false as const, reason: "page kill switch" };
  }
  return { ok: true as const };
}

const LOCK_MS = 90_000;

/**
 * Execute one action. Claiming is a single conditional UPDATE (status PENDING → CLAIMED with a lock), so
 * two workers can never run the same action. A crash after the Meta call but before SUCCEEDED leaves the
 * row CLAIMED with an expired lock → reconciliation checks Meta before deciding to retry (no duplicate replies).
 */
export async function executeAction(actionId: string, workerId = `w-${process.pid}`) {
  const claimed = await prisma.$executeRaw`UPDATE "OutboundAction" SET "status" = 'CLAIMED', "lockedUntil" = NOW() + (${LOCK_MS} || ' milliseconds')::interval, "lockedBy" = ${workerId}, "attempts" = "attempts" + 1, "updatedAt" = NOW()
    WHERE "id" = ${actionId} AND "status" = 'PENDING' AND "scheduledAt" <= NOW()`;
  if (claimed === 0) return { skipped: true as const };
  const action = await prisma.outboundAction.findUniqueOrThrow({ where: { id: actionId } });
  const actorType = action.createdById ? "USER" : "AI";

  const guard = await automationAllowed(action.workspaceId, action.pageId, actorType);
  if (!guard.ok) {
    await prisma.outboundAction.update({ where: { id: actionId }, data: { status: "CANCELLED", lastError: guard.reason, lockedUntil: null } });
    await linkModerationAction(actionId, "CANCELLED");
    return { cancelled: true as const, reason: guard.reason };
  }
  if (!action.pageId) throw new Error("action without page");

  try {
    const token = await pageToken(action.pageId);
    const page = await prisma.connectedPage.findUniqueOrThrow({ where: { id: action.pageId } });
    let externalId: string | null = null;
    const payload = action.payload as { message?: string; text?: string; psid?: string; tag?: string };
    switch (action.type) {
      case "HIDE_COMMENT":
        await graph.hideComment(action.targetId, token, true);
        await prisma.comment.updateMany({ where: { pageId: action.pageId, fbCommentId: action.targetId }, data: { isHidden: true } });
        if (actorType === "AI") await recordUsage(action.workspaceId, "AUTO_HIDE", 1, { type: "OutboundAction", id: action.id });
        break;
      case "UNHIDE_COMMENT":
        await graph.hideComment(action.targetId, token, false);
        await prisma.comment.updateMany({ where: { pageId: action.pageId, fbCommentId: action.targetId }, data: { isHidden: false } });
        break;
      case "REPLY_COMMENT": {
        const res = await graph.replyToComment(action.targetId, token, payload.message ?? "");
        externalId = res.id;
        if (actorType === "AI") await recordUsage(action.workspaceId, "AUTO_REPLY", 1, { type: "OutboundAction", id: action.id });
        break;
      }
      case "SEND_MESSAGE": {
        const res = await graph.sendMessage(page.fbPageId, token, payload.psid ?? action.targetId, payload.text ?? "", payload.tag);
        externalId = res.message_id;
        await prisma.message.updateMany({ where: { outboundActionId: action.id }, data: { status: "SENT", sentAt: new Date(), fbMessageId: res.message_id } });
        break;
      }
    }
    await prisma.outboundAction.update({ where: { id: actionId }, data: { status: "SUCCEEDED", externalId, completedAt: new Date(), lockedUntil: null, lastError: null } });
    await linkModerationAction(actionId, "SUCCEEDED");
    await audit({ workspaceId: action.workspaceId, actorUserId: action.createdById, actorType, action: `outbound.${action.type.toLowerCase()}_succeeded`, targetType: "OutboundAction", targetId: actionId, meta: { targetId: action.targetId, externalId } });
    return { ok: true as const, externalId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isGraph = err instanceof GraphError;
    if (isGraph && (err.isAuthError || (err.isPermissionError && err.code !== 200 /* 200 may be a one-off object permission */))) {
      await markPageTokenInvalid(action.pageId, message);
    }
    const retryable = isGraph ? err.isTransient : !/credentials are missing/.test(message);
    const exhausted = action.attempts >= action.maxAttempts;
    // A reply/message that MAY have gone out must never be blindly retried → reconciliation.
    const mayHaveSideEffect = (action.type === "REPLY_COMMENT" || action.type === "SEND_MESSAGE") && !(isGraph && err.status >= 400 && err.status < 500);
    const status = mayHaveSideEffect ? "NEEDS_RECONCILIATION" : retryable && !exhausted ? "PENDING" : "FAILED";
    await prisma.outboundAction.update({
      where: { id: actionId },
      data: { status, lastError: message.slice(0, 500), lockedUntil: null, scheduledAt: status === "PENDING" ? new Date(Date.now() + Math.min(300_000, 5000 * 2 ** action.attempts)) : action.scheduledAt },
    });
    if (status === "PENDING") await enqueueOutbox("outbound.execute", { actionId }, prisma, new Date(Date.now() + Math.min(300_000, 5000 * 2 ** action.attempts)));
    if (status !== "PENDING") {
      await linkModerationAction(actionId, status);
      await prisma.message.updateMany({ where: { outboundActionId: actionId }, data: { status: "FAILED", error: message.slice(0, 300) } });
    }
    log.warn("outbound action failed", { actionId, type: action.type, status, err: message });
    return { ok: false as const, status };
  }
}

async function linkModerationAction(outboundActionId: string, status: string) {
  await prisma.moderationAction.updateMany({ where: { outboundActionId }, data: { status } });
}

/**
 * Reconciliation (runs every 5 min): actions stuck CLAIMED past their lock, or NEEDS_RECONCILIATION.
 * For replies we look at the comment's replies on Meta — if our text already exists, mark SUCCEEDED
 * instead of sending again.
 */
export async function reconcileStaleActions() {
  const stale = await prisma.outboundAction.findMany({ where: { OR: [{ status: "CLAIMED", lockedUntil: { lt: new Date() } }, { status: "NEEDS_RECONCILIATION" }] }, take: 100 });
  let resolved = 0;
  for (const a of stale) {
    try {
      if (!a.pageId) continue;
      const token = await pageToken(a.pageId);
      if (a.type === "REPLY_COMMENT") {
        const c = await graph.getComment(a.targetId, token);
        const page = await prisma.connectedPage.findUniqueOrThrow({ where: { id: a.pageId } });
        const text = (a.payload as { message?: string }).message ?? "";
        const match = c.comments?.data.find((r) => r.from?.id === page.fbPageId && r.message === text);
        if (match) {
          await prisma.outboundAction.update({ where: { id: a.id }, data: { status: "SUCCEEDED", externalId: match.id, completedAt: new Date(), lockedUntil: null, lastError: "recovered via reconciliation" } });
          await linkModerationAction(a.id, "SUCCEEDED");
          resolved++;
          continue;
        }
      } else if (a.type === "HIDE_COMMENT" || a.type === "UNHIDE_COMMENT") {
        const c = await graph.getComment(a.targetId, token);
        const want = a.type === "HIDE_COMMENT";
        if (c.is_hidden === want) {
          await prisma.outboundAction.update({ where: { id: a.id }, data: { status: "SUCCEEDED", completedAt: new Date(), lockedUntil: null, lastError: "recovered via reconciliation" } });
          await prisma.comment.updateMany({ where: { pageId: a.pageId, fbCommentId: a.targetId }, data: { isHidden: want } });
          await linkModerationAction(a.id, "SUCCEEDED");
          resolved++;
          continue;
        }
      } else if (a.type === "SEND_MESSAGE") {
        // Messenger has no cheap way to verify; after one ambiguous failure we do NOT resend automatically.
        await prisma.outboundAction.update({ where: { id: a.id }, data: { status: "FAILED", lockedUntil: null, lastError: `${a.lastError ?? ""} | not retried: delivery ambiguous`.slice(0, 500) } });
        await prisma.message.updateMany({ where: { outboundActionId: a.id }, data: { status: "FAILED", error: "Delivery could not be confirmed. Please check Messenger and resend if needed." } });
        continue;
      }
      // Not done on Meta → safe to retry (bounded).
      if (a.attempts < a.maxAttempts) {
        await prisma.outboundAction.update({ where: { id: a.id }, data: { status: "PENDING", lockedUntil: null, scheduledAt: new Date() } });
        await enqueueOutbox("outbound.execute", { actionId: a.id });
      } else {
        await prisma.outboundAction.update({ where: { id: a.id }, data: { status: "FAILED", lockedUntil: null } });
        await linkModerationAction(a.id, "FAILED");
      }
    } catch (err) {
      log.warn("reconciliation failed", { actionId: a.id, err: String(err) });
    }
  }
  return { examined: stale.length, resolved };
}
