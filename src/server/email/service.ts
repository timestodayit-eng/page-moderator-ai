import { prisma, type Tx } from "../db";
import { encryptJson, decryptJson } from "../crypto";
import { env } from "../env";
import { log } from "../log";
import { renderEmail } from "./render";
import { emailProvider, isEmailEnabled } from "./transport";
import { enqueueOutbox } from "../queue/outbox";
import { TEMPLATES } from "./templates";

export type EmailVars = Record<string, string | number | undefined>;

type QueueInput = {
  to: string;
  templateKey: string;
  locale?: string;
  vars?: EmailVars;
  workspaceId?: string | null;
  userId?: string | null;
  campaignId?: string | null;
  scheduledAt?: Date;
  createdById?: string | null;
};

/**
 * Queue an email. The row is written in the caller's transaction (if any) together with an
 * outbox entry, so a crash between "DB committed" and "job enqueued" can never lose an email.
 */
export async function queueEmail(input: QueueInput, tx: Tx = prisma) {
  const def = TEMPLATES.find((t) => t.key === input.templateKey);
  if (!def) throw new Error(`Unknown email template ${input.templateKey}`);
  const to = input.to.trim().toLowerCase();

  // Suppression: marketing emails respect unsubscribe; ALL-scope suppressions (hard bounce / complaint) block everything
  // except security-critical AUTH mail.
  const suppression = await tx.emailSuppression.findUnique({ where: { email: to } });
  let status = "QUEUED";
  if (suppression) {
    if (def.category === "MARKETING") status = "SUPPRESSED";
    else if (suppression.scope === "ALL" && def.category !== "AUTH") status = "SUPPRESSED";
  }
  if (status === "QUEUED" && !isEmailEnabled()) {
    status = "FAILED";
  }

  const delivery = await tx.emailDelivery.create({
    data: {
      workspaceId: input.workspaceId ?? null,
      userId: input.userId ?? null,
      toEmail: to,
      templateKey: input.templateKey,
      locale: input.locale ?? "en",
      category: def.category,
      varsEnc: encryptJson(input.vars ?? {}),
      status,
      lastError: status === "FAILED" ? "Email provider not configured (EMAIL_PROVIDER)" : null,
      campaignId: input.campaignId ?? null,
      scheduledAt: input.scheduledAt ?? new Date(),
      createdById: input.createdById ?? null,
    },
  });
  if (status === "QUEUED") {
    await enqueueOutbox("email.send", { deliveryId: delivery.id }, tx, input.scheduledAt);
  } else if (status === "FAILED") {
    log.warn("email not sent: provider not configured", { templateKey: input.templateKey, deliveryId: delivery.id });
  }
  return delivery;
}

/** Worker-side: actually send one queued delivery. Idempotent via status transition. */
export async function deliverEmail(deliveryId: string) {
  const claimed = await prisma.emailDelivery.updateMany({
    where: { id: deliveryId, status: { in: ["QUEUED", "FAILED"] } },
    data: { status: "SENDING", attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return { skipped: true };
  const d = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  try {
    const vars = d.varsEnc ? decryptJson<EmailVars>(d.varsEnc) : {};
    const rendered = await renderEmail(d.templateKey, d.locale, vars);
    const headers: Record<string, string> = { "X-PM-Delivery": d.id };
    if (d.category === "MARKETING" && vars.unsubscribeUrl) headers["List-Unsubscribe"] = `<${vars.unsubscribeUrl}>`;
    const res = await emailProvider().send({ to: d.toEmail, subject: rendered.subject, html: rendered.html, text: rendered.text, category: d.category, headers });
    await prisma.emailDelivery.update({
      where: { id: d.id },
      data: { status: "SENT", sentAt: new Date(), provider: res.provider, providerMessageId: res.messageId, subject: rendered.subject, varsEnc: null, lastError: null },
    });
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.emailDelivery.update({ where: { id: d.id }, data: { status: "FAILED", lastError: message.slice(0, 500) } });
    throw err;
  }
}

export function appLink(path: string) {
  return new URL(path, env().APP_URL).toString();
}
