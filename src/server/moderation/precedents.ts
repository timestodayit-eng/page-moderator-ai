/**
 * Reviewer precedents — the "learn it forever" layer of moderation.
 *
 * When a human reviews a comment the AI was unsure about and ticks "always hide comments like this"
 * (or "never hide comments like this"), a ModerationPrecedent is stored for that Page or for the whole
 * workspace. From then on every new comment is checked against the precedents:
 *
 *  1. Deterministic match — identical or near-identical text (token Dice similarity ≥ EXACT_THRESHOLD)
 *     applies the ruling directly without calling the model (fast, free, 100% consistent).
 *  2. Semantic match — the most similar precedents are handed to the model as *binding rulings*; the
 *     model reports `precedent_match` when a new comment carries the same meaning/accusation/intent even
 *     with different wording, and the policy engine executes the ruling.
 *
 * No embeddings or DB extensions are required: similarity is computed in-process over the workspace's
 * precedents (capped), which keeps the feature identical across OpenAI / Claude / Gemini / DeepSeek.
 */
import { prisma } from "../db";
import { Errors } from "../errors";
import { audit } from "../audit";
import type { WorkspaceContext } from "../rbac/guard";
import { assertPageAccess } from "../rbac/guard";
import { PROTECTED_CATEGORIES, normalise, type Category } from "./classifier";

export const EXACT_THRESHOLD = 0.85;
export const CANDIDATE_THRESHOLD = 0.12;
const MAX_LOADED = 600;
const MAX_CANDIDATES = 8;
const MAX_RECENT = 4;

export type PrecedentDecision = "HIDE" | "KEEP";
export type PrecedentLite = { id: string; pageId: string | null; text: string; normalizedText: string; category: string; decision: PrecedentDecision; note: string };
export type PrecedentMatch = { exact: PrecedentLite | null; candidates: { precedent: PrecedentLite; similarity: number }[] };

/** Character bigrams of the normalised text (works for Bengali, Banglish and English alike). */
export function bigrams(text: string): Map<string, number> {
  const t = normalise(text).replace(/[^\p{L}\p{N}#<> ]/gu, "");
  const grams = new Map<string, number>();
  const words = t.split(" ").filter(Boolean);
  for (const w of words) {
    const padded = ` ${w} `;
    for (let i = 0; i < padded.length - 1; i++) {
      const g = padded.slice(i, i + 2);
      grams.set(g, (grams.get(g) ?? 0) + 1);
    }
  }
  return grams;
}

/** Sørensen–Dice coefficient over character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (!ga.size || !gb.size) return 0;
  let inter = 0;
  let sa = 0;
  let sb = 0;
  for (const v of ga.values()) sa += v;
  for (const v of gb.values()) sb += v;
  for (const [g, v] of ga) {
    const w = gb.get(g);
    if (w) inter += Math.min(v, w);
  }
  return (2 * inter) / (sa + sb);
}

export async function loadPrecedents(workspaceId: string, pageId: string | null): Promise<PrecedentLite[]> {
  const rows = await prisma.moderationPrecedent.findMany({
    where: { workspaceId, status: "ACTIVE", OR: [{ pageId: null }, ...(pageId ? [{ pageId }] : [])] },
    orderBy: [{ hits: "desc" }, { createdAt: "desc" }],
    take: MAX_LOADED,
    select: { id: true, pageId: true, text: true, normalizedText: true, category: true, decision: true, note: true },
  });
  return rows.map((r) => ({ ...r, decision: r.decision === "KEEP" ? "KEEP" : "HIDE" }));
}

/** Find the precedents relevant to one comment. Page-specific rulings win ties over workspace-wide ones. */
export function matchPrecedents(message: string, precedents: PrecedentLite[]): PrecedentMatch {
  const norm = normalise(message);
  const scored = precedents
    .map((p) => ({ precedent: p, similarity: p.normalizedText === norm ? 1 : similarity(message, p.text) }))
    .filter((x) => x.similarity >= CANDIDATE_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity || (b.precedent.pageId ? 1 : 0) - (a.precedent.pageId ? 1 : 0));
  const exact = scored[0] && scored[0].similarity >= EXACT_THRESHOLD ? scored[0].precedent : null;
  const top = scored.slice(0, MAX_CANDIDATES);
  // Always add a few recent rulings as well, so brand-new topics still reach the model.
  const seen = new Set(top.map((t) => t.precedent.id));
  const recent = precedents.filter((p) => !seen.has(p.id)).slice(0, MAX_RECENT).map((p) => ({ precedent: p, similarity: 0 }));
  return { exact, candidates: [...top, ...recent] };
}

export async function recordHit(precedentId: string) {
  await prisma.moderationPrecedent.update({ where: { id: precedentId }, data: { hits: { increment: 1 }, lastHitAt: new Date() } }).catch(() => {});
}

export type CreatePrecedentInput = {
  commentId: string;
  decision: PrecedentDecision;
  scope: "PAGE" | "WORKSPACE";
  category?: string | null;
  note?: string;
  sourceDecisionId?: string | null;
};

/**
 * Store a ruling from the review panel. A HIDE ruling for a protected category (inquiry/positive/neutral) is
 * recorded as NEGATIVE so that the "protected categories are never auto-hidden" invariant stays intact —
 * the reviewer's intent (hide this kind of comment) is still honoured.
 */
export async function createPrecedent(ctx: WorkspaceContext, input: CreatePrecedentInput, meta: { ip?: string | null }) {
  const c = await prisma.comment.findFirst({ where: { id: input.commentId, workspaceId: ctx.workspace.id }, include: { classifications: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!c) throw Errors.notFound("Comment");
  assertPageAccess(ctx, c.pageId);
  if (input.scope === "WORKSPACE" && ctx.access.pageAccess === "ASSIGNED") throw Errors.forbidden("Only members with access to all Pages can create workspace-wide rulings");
  let category = (input.category ?? c.classifications[0]?.category ?? "NEGATIVE") as Category;
  if (input.decision === "HIDE" && PROTECTED_CATEGORIES.includes(category)) category = "NEGATIVE";
  const normalizedText = normalise(c.message);
  const pageId = input.scope === "PAGE" ? c.pageId : null;
  const existing = await prisma.moderationPrecedent.findFirst({ where: { workspaceId: ctx.workspace.id, pageId, normalizedText } });
  const row = existing
    ? await prisma.moderationPrecedent.update({ where: { id: existing.id }, data: { decision: input.decision, category, note: input.note ?? existing.note, status: "ACTIVE", createdById: ctx.user.id, sourceCommentId: c.id, sourceDecisionId: input.sourceDecisionId ?? null } })
    : await prisma.moderationPrecedent.create({ data: { workspaceId: ctx.workspace.id, pageId, text: c.message, normalizedText, category, decision: input.decision, note: input.note ?? "", sourceCommentId: c.id, sourceDecisionId: input.sourceDecisionId ?? null, createdById: ctx.user.id } });
  await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: existing ? "moderation.precedent_updated" : "moderation.precedent_created", targetType: "ModerationPrecedent", targetId: row.id, ip: meta.ip, meta: { decision: input.decision, scope: input.scope, category, commentId: c.id } });
  return row;
}

export async function listPrecedents(ctx: WorkspaceContext, q: { pageId?: string; status?: string; decision?: string; search?: string; skip: number; take: number }) {
  const scope = ctx.access.pageAccess === "ASSIGNED" ? { OR: [{ pageId: null }, { pageId: { in: ctx.access.allowedPageIds } }] } : {};
  const where = {
    workspaceId: ctx.workspace.id,
    ...scope,
    ...(q.pageId ? { pageId: q.pageId } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.decision ? { decision: q.decision } : {}),
    ...(q.search ? { text: { contains: q.search, mode: "insensitive" as const } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.moderationPrecedent.count({ where }),
    prisma.moderationPrecedent.findMany({ where, orderBy: [{ createdAt: "desc" }], skip: q.skip, take: q.take }),
  ]);
  const pageIds = Array.from(new Set(rows.map((r) => r.pageId).filter(Boolean))) as string[];
  const pages = pageIds.length ? await prisma.connectedPage.findMany({ where: { id: { in: pageIds } }, select: { id: true, name: true } }) : [];
  const userIds = Array.from(new Set(rows.map((r) => r.createdById).filter(Boolean))) as string[];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const pageName = new Map(pages.map((p) => [p.id, p.name]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  return { total, rows: rows.map((r) => ({ ...r, pageName: r.pageId ? pageName.get(r.pageId) ?? null : null, createdByName: r.createdById ? userName.get(r.createdById) ?? null : null })) };
}

export async function updatePrecedent(ctx: WorkspaceContext, id: string, patch: { status?: "ACTIVE" | "DISABLED"; decision?: PrecedentDecision; note?: string; scope?: "PAGE" | "WORKSPACE" }, meta: { ip?: string | null }) {
  const row = await prisma.moderationPrecedent.findFirst({ where: { id, workspaceId: ctx.workspace.id } });
  if (!row) throw Errors.notFound("Precedent");
  if (row.pageId) assertPageAccess(ctx, row.pageId);
  else if (ctx.access.pageAccess === "ASSIGNED") throw Errors.forbidden("Workspace-wide rulings can only be changed by members with access to all Pages");
  let pageId = row.pageId;
  if (patch.scope === "WORKSPACE") {
    if (ctx.access.pageAccess === "ASSIGNED") throw Errors.forbidden("Only members with access to all Pages can create workspace-wide rulings");
    pageId = null;
  } else if (patch.scope === "PAGE" && !row.pageId) {
    const src = row.sourceCommentId ? await prisma.comment.findUnique({ where: { id: row.sourceCommentId }, select: { pageId: true } }) : null;
    if (!src) throw Errors.badRequest("This ruling has no source Page to narrow to");
    pageId = src.pageId;
  }
  const updated = await prisma.moderationPrecedent.update({ where: { id }, data: { status: patch.status, decision: patch.decision, note: patch.note, pageId } });
  await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "moderation.precedent_updated", targetType: "ModerationPrecedent", targetId: id, ip: meta.ip, meta: patch });
  return updated;
}

export async function deletePrecedent(ctx: WorkspaceContext, id: string, meta: { ip?: string | null }) {
  const row = await prisma.moderationPrecedent.findFirst({ where: { id, workspaceId: ctx.workspace.id } });
  if (!row) throw Errors.notFound("Precedent");
  if (row.pageId) assertPageAccess(ctx, row.pageId);
  else if (ctx.access.pageAccess === "ASSIGNED") throw Errors.forbidden("Workspace-wide rulings can only be removed by members with access to all Pages");
  await prisma.moderationPrecedent.delete({ where: { id } });
  await audit({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "moderation.precedent_deleted", targetType: "ModerationPrecedent", targetId: id, ip: meta.ip, meta: { text: row.text.slice(0, 120), decision: row.decision } });
}
