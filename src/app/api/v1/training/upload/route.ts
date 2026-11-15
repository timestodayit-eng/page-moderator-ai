import { NextResponse } from "next/server";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { Errors } from "@/server/errors";
import { storage } from "@/server/storage/driver";
import { enqueueOutbox } from "@/server/queue/outbox";
import { getEffectiveLimits, recordUsage } from "@/server/billing/usage";
import { audit } from "@/server/audit";

const ALLOWED = new Set(["application/pdf", "text/plain", "text/csv", "text/markdown"]);
const MAX_BYTES = 15 * 1024 * 1024;

/** multipart/form-data: file, title, kind, agentId? — stored privately then indexed by the worker. */
export const POST = api({ permission: "agents.train", csrf: true }, async ({ req, ws, ip }) => {
  const form = await req.formData().catch(() => {
    throw Errors.badRequest("Expected multipart/form-data");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw Errors.badRequest("file is required");
  if (file.size > MAX_BYTES) throw Errors.badRequest("File too large (max 15 MB)");
  const type = file.type || (file.name.endsWith(".pdf") ? "application/pdf" : file.name.endsWith(".csv") ? "text/csv" : "text/plain");
  if (!ALLOWED.has(type)) throw Errors.badRequest("Unsupported file type (PDF, TXT, MD, CSV)");
  const limits = await getEffectiveLimits(ws!.workspace.id);
  const used = await prisma.knowledgeSource.aggregate({ _sum: { sizeBytes: true }, where: { workspaceId: ws!.workspace.id } });
  if ((used._sum.sizeBytes ?? 0) + file.size > limits.storageMb * 1024 * 1024) throw Errors.limitReached(`Storage limit of ${limits.storageMb} MB reached`);
  const title = String(form.get("title") ?? file.name).slice(0, 120);
  const kind = type === "application/pdf" ? "pdf" : type === "text/csv" ? "csv" : "text";
  const buf = Buffer.from(await file.arrayBuffer());
  const source = await prisma.knowledgeSource.create({ data: { workspaceId: ws!.workspace.id, title, kind, mimeType: type, sizeBytes: file.size, agentId: (form.get("agentId") as string) || null, createdById: ws!.user.id } });
  const key = `knowledge/${ws!.workspace.id}/${source.id}${type === "application/pdf" ? ".pdf" : type === "text/csv" ? ".csv" : ".txt"}`;
  await storage().write(key, buf, type);
  await prisma.$transaction(async (tx) => {
    await tx.knowledgeSource.update({ where: { id: source.id }, data: { storageKey: key } });
    await enqueueOutbox("ai.ingest-knowledge", { sourceId: source.id }, tx);
    await recordUsage(ws!.workspace.id, "STORAGE_BYTES", file.size, { type: "KnowledgeSource", id: source.id }, tx);
    await audit({ workspaceId: ws!.workspace.id, actorUserId: ws!.user.id, action: "knowledge.uploaded", targetType: "KnowledgeSource", targetId: source.id, ip, meta: { title, type, size: file.size } }, tx);
  });
  return NextResponse.json({ source: { id: source.id, status: "PROCESSING" } });
});
