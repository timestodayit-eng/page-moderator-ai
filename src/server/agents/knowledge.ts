import { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "../db";
import { log } from "../log";

/**
 * Knowledge retrieval without external embeddings: documents are chunked at ingest, and retrieval uses
 * Postgres full-text search (simple config works for Bengali tokens too) combined with trigram-free
 * keyword overlap scoring. Good enough for FAQ/policy/pricing lookups; swap for pgvector later.
 */
export function chunkText(text: string, maxChars = 900): string[] {
  const paras = text.replace(/\r/g, "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > maxChars && cur) {
      chunks.push(cur);
      cur = p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
    while (cur.length > maxChars * 1.5) {
      chunks.push(cur.slice(0, maxChars));
      cur = cur.slice(maxChars);
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export async function indexSource(sourceId: string, text: string, tx: Tx = prisma) {
  const source = await tx.knowledgeSource.findUniqueOrThrow({ where: { id: sourceId } });
  await tx.knowledgeChunk.deleteMany({ where: { sourceId } });
  const chunks = chunkText(text);
  if (chunks.length) await tx.knowledgeChunk.createMany({ data: chunks.map((content, ordinal) => ({ workspaceId: source.workspaceId, sourceId, ordinal, content })) });
  await tx.knowledgeSource.update({ where: { id: sourceId }, data: { status: "READY", error: null, sizeBytes: Buffer.byteLength(text, "utf8") } });
  return chunks.length;
}

function tokens(q: string) {
  return [...new Set(q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((t) => t.length > 2))].slice(0, 24);
}

export async function retrieveKnowledge(workspaceId: string, query: string, opts: { sourceIds?: string[]; limit?: number } = {}) {
  const limit = opts.limit ?? 5;
  const toks = tokens(query);
  if (!toks.length) return [] as { id: string; content: string; sourceId: string; score: number }[];
  try {
    const tsQuery = toks.map((t) => t.replace(/'/g, "")).join(" | ");
    const rows = await prisma.$queryRaw<{ id: string; content: string; sourceId: string; score: number }[]>`
      SELECT c."id", c."content", c."sourceId",
        ts_rank(to_tsvector('simple', c."content"), to_tsquery('simple', ${tsQuery})) AS score
      FROM "KnowledgeChunk" c
      JOIN "KnowledgeSource" s ON s."id" = c."sourceId" AND s."status" = 'READY'
      WHERE c."workspaceId" = ${workspaceId}
        ${opts.sourceIds?.length ? Prisma.sql`AND c."sourceId" = ANY(${opts.sourceIds})` : Prisma.empty}
        AND to_tsvector('simple', c."content") @@ to_tsquery('simple', ${tsQuery})
      ORDER BY score DESC LIMIT ${limit}`;
    if (rows.length) return rows;
  } catch (err) {
    log.debug("fts retrieval failed, falling back to keyword overlap", { err: String(err) });
  }
  // Fallback: keyword overlap in JS (small corpora).
  const chunks = await prisma.knowledgeChunk.findMany({ where: { workspaceId, source: { status: "READY" }, ...(opts.sourceIds?.length ? { sourceId: { in: opts.sourceIds } } : {}) }, take: 2000, select: { id: true, content: true, sourceId: true } });
  return chunks
    .map((c) => ({ ...c, score: toks.filter((t) => c.content.toLowerCase().includes(t)).length }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
