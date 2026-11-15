import type { Job } from "bullmq";
import { prisma } from "@/server/db";
import { log } from "@/server/log";
import { enqueueOutbox } from "@/server/queue/outbox";
import { ingestMessagingEvent } from "@/server/inbox/ingest";

type FeedValue = { item?: string; verb?: string; comment_id?: string; post_id?: string; parent_id?: string; from?: { id: string; name?: string }; message?: string; created_time?: number; is_hidden?: boolean; permalink_url?: string };

/** Turns a stored webhook event into domain records (Comment / Message) and queues follow-up work. */
export async function metaEventJob(job: Job<{ eventId: string }>) {
  const ev = await prisma.webhookEvent.findUnique({ where: { id: job.data.eventId } });
  if (!ev || ev.status === "PROCESSED" || ev.status === "IGNORED") return { skipped: true };
  await prisma.webhookEvent.update({ where: { id: ev.id }, data: { status: "PROCESSING", attempts: { increment: 1 } } });
  try {
    const payload = ev.payload as { pageId: string; change?: { field: string; value: FeedValue }; messaging?: Record<string, unknown> };
    const page = await prisma.connectedPage.findFirst({ where: { fbPageId: payload.pageId, status: { not: "DISCONNECTED" } } });
    if (!page) {
      await prisma.webhookEvent.update({ where: { id: ev.id }, data: { status: "IGNORED", lastError: "page not connected" } });
      return { ignored: true };
    }
    let result: unknown = null;
    if (payload.change?.field === "feed") result = await handleFeed(page.id, page.workspaceId, page.fbPageId, payload.change.value);
    else if (payload.messaging) result = await ingestMessagingEvent(page, payload.messaging as never);
    await prisma.webhookEvent.update({ where: { id: ev.id }, data: { status: "PROCESSED", processedAt: new Date(), lastError: null } });
    return result;
  } catch (err) {
    await prisma.webhookEvent.update({ where: { id: ev.id }, data: { status: "FAILED", lastError: String(err).slice(0, 500) } });
    log.error("meta event failed", { eventId: ev.id, err: String(err) });
    throw err;
  }
}

async function handleFeed(pageId: string, workspaceId: string, fbPageId: string, v: FeedValue) {
  if (v.item !== "comment" || !v.comment_id) return { ignored: v.item };
  if (v.verb === "remove") {
    await prisma.comment.updateMany({ where: { pageId, fbCommentId: v.comment_id }, data: { status: "SKIPPED", lastError: "removed on Facebook" } });
    return { removed: true };
  }
  if (v.verb === "hide" || v.verb === "unhide") {
    await prisma.comment.updateMany({ where: { pageId, fbCommentId: v.comment_id }, data: { isHidden: v.verb === "hide" } });
    return { visibility: v.verb };
  }
  if (v.verb !== "add" && v.verb !== "edited") return { ignored: v.verb };
  if (v.from?.id === fbPageId) {
    // Page's own comments/replies are stored but never moderated.
    await prisma.comment.upsert({ where: { pageId_fbCommentId: { pageId, fbCommentId: v.comment_id } }, update: { message: v.message ?? "" }, create: { workspaceId, pageId, fbCommentId: v.comment_id, fbPostId: v.post_id, fbParentId: v.parent_id, authorFbId: v.from.id, authorName: v.from.name, message: v.message ?? "", permalink: v.permalink_url, createdTime: v.created_time ? new Date(v.created_time * 1000) : new Date(), status: "SKIPPED", isHidden: Boolean(v.is_hidden) } });
    return { own: true };
  }
  const comment = await prisma.$transaction(async (tx) => {
    const c = await tx.comment.upsert({
      where: { pageId_fbCommentId: { pageId, fbCommentId: v.comment_id! } },
      update: v.verb === "edited" ? { message: v.message ?? "", status: "NEW" } : {},
      create: { workspaceId, pageId, fbCommentId: v.comment_id!, fbPostId: v.post_id, fbParentId: v.parent_id, authorFbId: v.from?.id, authorName: v.from?.name, message: v.message ?? "", permalink: v.permalink_url, createdTime: v.created_time ? new Date(v.created_time * 1000) : new Date(), isHidden: Boolean(v.is_hidden) },
    });
    if (c.status === "NEW") await enqueueOutbox("moderation.process", { commentId: c.id }, tx);
    return c;
  });
  return { commentId: comment.id };
}
