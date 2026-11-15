import type { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "../db";

/**
 * Transactional outbox. Business code writes an outbox row inside its own transaction; the worker's
 * dispatcher (worker/outbox.ts) moves rows onto BullMQ. This guarantees at-least-once job delivery even
 * if Redis is unreachable at write time. Consumers must be idempotent.
 */
export async function enqueueOutbox(topic: string, payload: Record<string, unknown>, tx: Tx = prisma, availableAt?: Date) {
  return tx.webhookOutbox.create({ data: { topic, payload: payload as Prisma.InputJsonValue, availableAt: availableAt ?? new Date() } });
}
