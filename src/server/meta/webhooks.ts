import { prisma } from "../db";
import { env } from "../env";
import { hmacSha256Hex, safeEqual, sha256 } from "../crypto";
import { log } from "../log";
import { enqueueOutbox } from "../queue/outbox";

/** GET verification handshake. */
export function verifyChallenge(params: URLSearchParams) {
  const token = env().META_WEBHOOK_VERIFY_TOKEN;
  if (!token) return null;
  if (params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") && safeEqual(params.get("hub.verify_token")!, token)) return params.get("hub.challenge");
  return null;
}

/** X-Hub-Signature-256 over the RAW body with the app secret. */
export function verifySignature(rawBody: string | Buffer, header: string | null) {
  const secret = env().META_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = hmacSha256Hex(secret, rawBody);
  return safeEqual(header.slice(7), expected);
}

type FeedChange = { field: string; value: { item?: string; verb?: string; comment_id?: string; post_id?: string; parent_id?: string; from?: { id: string; name?: string }; message?: string; created_time?: number; is_hidden?: boolean; permalink_url?: string } };
type MessagingEvent = { sender: { id: string }; recipient: { id: string }; timestamp: number; message?: { mid: string; text?: string; attachments?: unknown[]; is_echo?: boolean }; postback?: { payload: string; title?: string }; read?: { watermark: number } };
export type MetaPayload = { object: string; entry: { id: string; time: number; changes?: FeedChange[]; messaging?: MessagingEvent[] }[] };

/**
 * Store every entry durably (deduped by a stable key) BEFORE acknowledging, then hand it to the worker
 * via the outbox. Processing happens asynchronously so Meta always gets a fast 200.
 */
export async function ingestWebhook(payload: MetaPayload, signatureValid: boolean) {
  const stored: string[] = [];
  for (const entry of payload.entry ?? []) {
    const units: { key: string; data: unknown; kind: string }[] = [];
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      const key = v.comment_id ? `feed:${v.comment_id}:${v.verb ?? "add"}` : `feed:${entry.id}:${sha256(JSON.stringify(ch)).slice(0, 24)}`;
      units.push({ key, data: { pageId: entry.id, change: ch }, kind: "feed" });
    }
    for (const m of entry.messaging ?? []) {
      const key = m.message?.mid ? `msg:${m.message.mid}` : `msg:${entry.id}:${m.sender.id}:${m.timestamp}:${sha256(JSON.stringify(m)).slice(0, 12)}`;
      units.push({ key, data: { pageId: entry.id, messaging: m }, kind: "messaging" });
    }
    if (!units.length) units.push({ key: `raw:${entry.id}:${entry.time}:${sha256(JSON.stringify(entry)).slice(0, 16)}`, data: entry, kind: "unknown" });

    for (const u of units) {
      const page = await prisma.connectedPage.findFirst({ where: { fbPageId: entry.id, status: { not: "DISCONNECTED" } }, select: { id: true, workspaceId: true } });
      try {
        await prisma.$transaction(async (tx) => {
          const ev = await tx.webhookEvent.create({ data: { source: "meta", dedupeKey: signatureValid ? u.key : `${u.key}:unsigned:${sha256(JSON.stringify(u.data)).slice(0, 8)}`, signatureValid, payload: u.data as object, status: signatureValid && page ? "QUEUED" : "IGNORED", workspaceId: page?.workspaceId ?? null, lastError: !signatureValid ? "invalid signature" : !page ? "page not connected" : null } });
          if (signatureValid && page) await enqueueOutbox("meta.event", { eventId: ev.id }, tx);
          stored.push(ev.id);
        });
      } catch (err) {
        // Unique violation on dedupeKey → duplicate delivery from Meta; ignore silently.
        if (!(err instanceof Error && /Unique constraint/i.test(err.message))) {
          log.error("webhook store failed", { err, key: u.key });
          throw err;
        }
      }
    }
  }
  return stored;
}
