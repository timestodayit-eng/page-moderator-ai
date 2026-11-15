import { prisma } from "../db";
import { log } from "../log";
import { storage } from "../storage/driver";
import { indexSource } from "./knowledge";

/** Extract text from an uploaded knowledge file (txt/md/csv/pdf) and index it. */
export async function ingestKnowledgeFile(sourceId: string) {
  const src = await prisma.knowledgeSource.findUnique({ where: { id: sourceId } });
  if (!src || !src.storageKey) return { skipped: true };
  try {
    const buf = await storage().read(src.storageKey);
    let text = "";
    if (src.mimeType === "application/pdf" || src.storageKey.endsWith(".pdf")) text = await extractPdfText(buf);
    else if (src.mimeType === "text/csv" || src.storageKey.endsWith(".csv")) text = csvToText(buf.toString("utf8"));
    else text = buf.toString("utf8");
    if (!text.trim()) throw new Error("No readable text found in the file");
    const chunks = await indexSource(sourceId, text);
    return { chunks };
  } catch (err) {
    await prisma.knowledgeSource.update({ where: { id: sourceId }, data: { status: "FAILED", error: String(err).slice(0, 300) } });
    log.warn("knowledge ingest failed", { sourceId, err: String(err) });
    return { failed: true };
  }
}

function csvToText(csv: string) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return "";
  const header = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((l) => { const cells = l.split(","); return header.map((h, i) => `${h}: ${(cells[i] ?? "").trim()}`).join("; "); }).join("\n\n");
}

/** Minimal PDF text extraction (text-based PDFs) without native deps: pulls strings from content streams. */
async function extractPdfText(buf: Buffer) {
  const { inflateSync } = await import("node:zlib");
  const raw = buf.toString("latin1");
  const out: string[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw))) {
    let content = m[1];
    try {
      content = inflateSync(Buffer.from(content, "latin1")).toString("latin1");
    } catch {
      /* uncompressed stream */
    }
    const textRe = /\[(.*?)\]\s*TJ|\((.*?)\)\s*Tj/g;
    let t: RegExpExecArray | null;
    const parts: string[] = [];
    while ((t = textRe.exec(content))) {
      const s = t[1] !== undefined ? t[1].replace(/\((.*?)\)(-?\d+)?/g, "$1") : t[2];
      parts.push(s.replace(/\\\(/g, "(").replace(/\\\)/g, ")").replace(/\\n/g, "\n"));
    }
    if (parts.length) out.push(parts.join(""));
  }
  return out.join("\n\n").replace(/[^\S\n]+/g, " ").trim();
}
