import type { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "./db";
import { redact } from "./log";

export type AuditInput = {
  workspaceId?: string | null;
  actorUserId?: string | null;
  actorType?: "USER" | "SYSTEM" | "AI" | "WEBHOOK";
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown>;
};

export async function audit(input: AuditInput, tx: Tx = prisma) {
  await tx.auditLog.create({
    data: {
      workspaceId: input.workspaceId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorType ?? (input.actorUserId ? "USER" : "SYSTEM"),
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      meta: (redact(input.meta ?? {}) ?? {}) as Prisma.InputJsonValue,
    },
  });
}
