import { prisma, type Tx } from "../db";
import { audit } from "../audit";
import { log } from "../log";
import { appLink, queueEmail } from "../email/service";
import { Errors } from "../errors";

const GRACE_DAYS = 7;
const DAY = 86_400_000;

export function money(cents: number, currency = "USD") {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

async function owners(workspaceId: string, tx: Tx = prisma) {
  return tx.membership.findMany({ where: { workspaceId, role: { key: { in: ["owner", "admin"] } }, status: "ACTIVE" }, include: { user: true, workspace: { select: { name: true, slug: true } } } });
}

export async function nextInvoiceNumber(tx: Tx = prisma) {
  const year = new Date().getUTCFullYear();
  const count = await tx.invoice.count({ where: { number: { startsWith: `INV-${year}-` } } });
  return `INV-${year}-${String(count + 1).padStart(5, "0")}`;
}

/** Create an invoice for the next period of a subscription (idempotent per period). */
export async function createRenewalInvoice(workspaceId: string, opts: { createdById?: string | null; periodStart?: Date; periodEnd?: Date } = {}, tx: Tx = prisma) {
  const sub = await tx.subscription.findUnique({ where: { workspaceId }, include: { plan: true, workspace: true } });
  if (!sub) throw Errors.notFound("Subscription");
  if (sub.workspace.billingExempt) return null;
  const periodStart = opts.periodStart ?? sub.currentPeriodEnd;
  const periodEnd = opts.periodEnd ?? new Date(periodStart.getTime() + (sub.interval === "YEARLY" ? 365 : 30) * DAY);
  const existing = await tx.invoice.findFirst({ where: { subscriptionId: sub.id, periodStart, status: { in: ["OPEN", "PAID"] } } });
  if (existing) return existing;
  const price = sub.interval === "YEARLY" ? sub.plan.priceYearlyCents : sub.plan.priceMonthlyCents;
  const discount = Math.round((price * sub.discountPercent) / 100);
  const total = price - discount;
  const invoice = await tx.invoice.create({
    data: { workspaceId, subscriptionId: sub.id, number: await nextInvoiceNumber(tx), status: total === 0 ? "PAID" : "OPEN", currency: sub.plan.currency, subtotalCents: price, discountCents: discount, totalCents: total, periodStart, periodEnd, dueAt: new Date(Math.max(Date.now(), periodStart.getTime() - 3 * DAY)), paidAt: total === 0 ? new Date() : null, createdById: opts.createdById ?? null, lines: [{ description: `${sub.plan.name} plan (${sub.interval.toLowerCase()})`, amountCents: price }, ...(discount ? [{ description: `Discount ${sub.discountPercent}%`, amountCents: -discount }] : [])] },
  });
  if (total > 0) {
    for (const m of await owners(workspaceId, tx)) {
      await queueEmail({ to: m.user.email, templateKey: "billing.invoice", workspaceId, userId: m.userId, locale: m.user.locale, vars: { name: m.user.name, workspaceName: m.workspace.name, invoiceNumber: invoice.number, amount: money(total, invoice.currency), dueDate: invoice.dueAt.toISOString().slice(0, 10), ctaUrl: appLink(`/app/${m.workspace.slug}/billing`) } }, tx);
    }
  }
  await audit({ workspaceId, actorUserId: opts.createdById ?? null, actorType: opts.createdById ? "USER" : "SYSTEM", action: "billing.invoice_created", targetType: "Invoice", targetId: invoice.id, meta: { number: invoice.number, total } }, tx);
  return invoice;
}

/**
 * Mark an invoice paid ONLY after the provider (or an authorised human for manual payments) confirmed it.
 * Idempotent on (provider, providerPaymentId). Extends the subscription period and restores service.
 */
export async function recordPayment(input: { invoiceId: string; provider: string; providerPaymentId: string; amountCents: number; currency: string; recordedById?: string | null; reference?: string; raw?: Record<string, unknown> }, tx: Tx = prisma) {
  const invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId }, include: { workspace: true } });
  if (!invoice) throw Errors.notFound("Invoice");
  const dup = await tx.payment.findUnique({ where: { provider_providerPaymentId: { provider: input.provider, providerPaymentId: input.providerPaymentId } } });
  if (dup) return { duplicate: true, payment: dup };
  if (input.amountCents < invoice.totalCents) throw Errors.badRequest(`Payment ${input.amountCents} is less than invoice total ${invoice.totalCents}`);
  const payment = await tx.payment.create({ data: { workspaceId: invoice.workspaceId, invoiceId: invoice.id, provider: input.provider, providerPaymentId: input.providerPaymentId, amountCents: input.amountCents, currency: input.currency, status: "SUCCEEDED", confirmedAt: new Date(), recordedById: input.recordedById ?? null, reference: input.reference, raw: (input.raw ?? {}) as object } });
  await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PAID", paidAt: new Date() } });
  if (invoice.subscriptionId && invoice.periodEnd) {
    const sub = await tx.subscription.findUnique({ where: { id: invoice.subscriptionId } });
    if (sub) {
      await tx.subscription.update({ where: { id: sub.id }, data: { status: "ACTIVE", currentPeriodStart: invoice.periodStart ?? sub.currentPeriodStart, currentPeriodEnd: invoice.periodEnd > sub.currentPeriodEnd ? invoice.periodEnd : sub.currentPeriodEnd, graceEndsAt: null, trialEndsAt: null } });
      if (invoice.workspace.status === "SUSPENDED") await tx.workspace.update({ where: { id: invoice.workspaceId }, data: { status: "ACTIVE", emergencyPause: false } });
    }
  }
  for (const m of await owners(invoice.workspaceId, tx)) {
    await queueEmail({ to: m.user.email, templateKey: "billing.payment_received", workspaceId: invoice.workspaceId, userId: m.userId, locale: m.user.locale, vars: { name: m.user.name, workspaceName: m.workspace.name, invoiceNumber: invoice.number, amount: money(input.amountCents, input.currency), ctaUrl: appLink(`/app/${m.workspace.slug}/billing`) } }, tx);
  }
  await audit({ workspaceId: invoice.workspaceId, actorUserId: input.recordedById ?? null, actorType: input.recordedById ? "USER" : "WEBHOOK", action: "billing.payment_recorded", targetType: "Invoice", targetId: invoice.id, meta: { provider: input.provider, providerPaymentId: input.providerPaymentId, amountCents: input.amountCents } }, tx);
  return { duplicate: false, payment };
}

export async function paymentFailed(invoiceId: string, reason: string, raw?: Record<string, unknown>, tx: Tx = prisma) {
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { workspace: true } });
  if (!invoice) return;
  const sub = invoice.subscriptionId ? await tx.subscription.findUnique({ where: { id: invoice.subscriptionId } }) : null;
  const graceEnds = new Date(Date.now() + GRACE_DAYS * DAY);
  if (sub && sub.status === "ACTIVE") await tx.subscription.update({ where: { id: sub.id }, data: { status: "PAST_DUE", graceEndsAt: graceEnds } });
  for (const m of await owners(invoice.workspaceId, tx)) {
    await queueEmail({ to: m.user.email, templateKey: "billing.payment_failed", workspaceId: invoice.workspaceId, userId: m.userId, locale: m.user.locale, vars: { name: m.user.name, workspaceName: m.workspace.name, invoiceNumber: invoice.number, amount: money(invoice.totalCents, invoice.currency), reason, graceDate: graceEnds.toISOString().slice(0, 10), ctaUrl: appLink(`/app/${m.workspace.slug}/billing`) } }, tx);
  }
  await audit({ workspaceId: invoice.workspaceId, actorType: "WEBHOOK", action: "billing.payment_failed", targetType: "Invoice", targetId: invoice.id, meta: { reason, raw } }, tx);
}

/**
 * Hourly lifecycle pass:
 *  - trial ending in 3 days → email; trial ended → invoice + GRACE
 *  - renewal in 7 days → upcoming-renewal email + invoice
 *  - period ended unpaid → PAST_DUE/GRACE; grace ended → EXPIRED + service paused
 *  - reminders for open invoices due in 2 days / overdue
 */
export async function runBillingCycle() {
  const now = new Date();
  const stats = { trialWarned: 0, trialEnded: 0, renewalInvoiced: 0, graced: 0, expired: 0, reminded: 0 };
  const subs = await prisma.subscription.findMany({ where: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE"] }, workspace: { billingExempt: false, status: { not: "CLOSED" } } }, include: { plan: true, workspace: true } });
  for (const sub of subs) {
    try {
      const ws = sub.workspace;
      const os = await owners(ws.id);
      const marker = async (key: string) => {
        const k = `billing.notice.${sub.id}.${key}`;
        const exists = await prisma.platformSetting.findUnique({ where: { key: k } });
        if (exists) return false;
        await prisma.platformSetting.create({ data: { key: k, value: { at: now.toISOString() } } });
        return true;
      };
      if (sub.status === "TRIALING" && sub.trialEndsAt) {
        const daysLeft = Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / DAY);
        if (daysLeft <= 3 && daysLeft > 0 && (await marker(`trial-${sub.trialEndsAt.toISOString().slice(0, 10)}`))) {
          for (const m of os) await queueEmail({ to: m.user.email, templateKey: "billing.trial_ending", workspaceId: ws.id, userId: m.userId, locale: m.user.locale, vars: { name: m.user.name, workspaceName: ws.name, days: daysLeft, date: sub.trialEndsAt.toISOString().slice(0, 10), ctaUrl: appLink(`/app/${ws.slug}/billing`) } });
          stats.trialWarned++;
        }
        if (sub.trialEndsAt <= now) {
          await prisma.$transaction(async (tx) => {
            await createRenewalInvoice(ws.id, { periodStart: sub.trialEndsAt! }, tx);
            await tx.subscription.update({ where: { id: sub.id }, data: { status: "GRACE", graceEndsAt: new Date(now.getTime() + GRACE_DAYS * DAY) } });
          });
          stats.trialEnded++;
        }
        continue;
      }
      if (sub.status === "ACTIVE") {
        const daysLeft = Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / DAY);
        if (daysLeft <= 7 && daysLeft > 0 && !sub.cancelAtPeriodEnd && (await marker(`renewal-${sub.currentPeriodEnd.toISOString().slice(0, 10)}`))) {
          const inv = await prisma.$transaction((tx) => createRenewalInvoice(ws.id, {}, tx));
          for (const m of os) await queueEmail({ to: m.user.email, templateKey: "billing.renewal_upcoming", workspaceId: ws.id, userId: m.userId, locale: m.user.locale, vars: { name: m.user.name, workspaceName: ws.name, planName: sub.plan.name, date: sub.currentPeriodEnd.toISOString().slice(0, 10), amount: inv ? money(inv.totalCents, inv.currency) : "", ctaUrl: appLink(`/app/${ws.slug}/billing`) } });
          stats.renewalInvoiced++;
        }
        if (sub.currentPeriodEnd <= now) {
          if (sub.cancelAtPeriodEnd) {
            await prisma.subscription.update({ where: { id: sub.id }, data: { status: "CANCELED", canceledAt: now } });
            stats.expired++;
          } else {
            await prisma.subscription.update({ where: { id: sub.id }, data: { status: "GRACE", graceEndsAt: new Date(now.getTime() + GRACE_DAYS * DAY) } });
            stats.graced++;
          }
        }
        continue;
      }
      if ((sub.status === "GRACE" || sub.status === "PAST_DUE") && sub.graceEndsAt && sub.graceEndsAt <= now) {
        await prisma.$transaction(async (tx) => {
          await tx.subscription.update({ where: { id: sub.id }, data: { status: "EXPIRED" } });
          await tx.workspace.update({ where: { id: ws.id }, data: { emergencyPause: true } });
          await tx.outboundAction.updateMany({ where: { workspaceId: ws.id, status: "PENDING" }, data: { status: "CANCELLED", lastError: "subscription expired" } });
          for (const m of os) await queueEmail({ to: m.user.email, templateKey: "billing.subscription_expired", workspaceId: ws.id, userId: m.userId, locale: m.user.locale, vars: { name: m.user.name, workspaceName: ws.name, date: now.toISOString().slice(0, 10), ctaUrl: appLink(`/app/${ws.slug}/billing`) } }, tx);
          await audit({ workspaceId: ws.id, actorType: "SYSTEM", action: "billing.subscription_expired", targetType: "Subscription", targetId: sub.id }, tx);
        });
        stats.expired++;
      }
    } catch (err) {
      log.error("billing cycle failed for subscription", { subscriptionId: sub.id, err: String(err) });
    }
  }
  // Payment reminders
  const open = await prisma.invoice.findMany({ where: { status: "OPEN", totalCents: { gt: 0 } }, include: { workspace: true } });
  for (const inv of open) {
    const days = Math.ceil((inv.dueAt.getTime() - now.getTime()) / DAY);
    const stage = days <= 0 ? "overdue" : days <= 2 ? "due-soon" : null;
    if (!stage) continue;
    const key = `billing.reminder.${inv.id}.${stage}`;
    if (await prisma.platformSetting.findUnique({ where: { key } })) continue;
    await prisma.platformSetting.create({ data: { key, value: { at: now.toISOString() } } });
    for (const m of await owners(inv.workspaceId)) await queueEmail({ to: m.user.email, templateKey: "billing.reminder", workspaceId: inv.workspaceId, userId: m.userId, locale: m.user.locale, vars: { name: m.user.name, workspaceName: inv.workspace.name, invoiceNumber: inv.number, amount: money(inv.totalCents, inv.currency), dueDate: inv.dueAt.toISOString().slice(0, 10), ctaUrl: appLink(`/app/${inv.workspace.slug}/billing`) } });
    stats.reminded++;
  }
  return stats;
}

/** Customer-initiated plan change: upgrades apply immediately with a prorated invoice; downgrades at period end. */
export async function changePlan(workspaceId: string, planKey: string, interval: "MONTHLY" | "YEARLY", actorId: string) {
  const sub = await prisma.subscription.findUnique({ where: { workspaceId }, include: { plan: true, workspace: true } });
  if (!sub) throw Errors.notFound("Subscription");
  const plan = await prisma.plan.findUnique({ where: { key: planKey } });
  if (!plan || !plan.isActive || !plan.isPublic) throw Errors.notFound("Plan");
  if (plan.key === "enterprise" && plan.priceMonthlyCents === 0) throw Errors.badRequest("Enterprise plans are set up by our team — contact support.");
  const upgrade = plan.sortOrder > sub.plan.sortOrder || (plan.key === sub.plan.key && interval === "YEARLY" && sub.interval === "MONTHLY");
  return prisma.$transaction(async (tx) => {
    if (upgrade || sub.status !== "ACTIVE") {
      const now = new Date();
      const end = new Date(now.getTime() + (interval === "YEARLY" ? 365 : 30) * DAY);
      await tx.subscription.update({ where: { id: sub.id }, data: { planId: plan.id, interval, cancelAtPeriodEnd: false } });
      const invoice = await createRenewalInvoice(workspaceId, { createdById: actorId, periodStart: now, periodEnd: end }, tx);
      await audit({ workspaceId, actorUserId: actorId, action: "billing.plan_change_requested", targetType: "Subscription", targetId: sub.id, meta: { from: sub.plan.key, to: plan.key, interval, immediate: true } }, tx);
      return { immediate: true, invoiceId: invoice?.id ?? null, message: sub.status === "TRIALING" ? "Plan selected. Pay the invoice to activate." : "Upgrade invoice created; new limits apply once paid." };
    }
    await tx.subscription.update({ where: { id: sub.id }, data: { planId: plan.id, interval } });
    await audit({ workspaceId, actorUserId: actorId, action: "billing.plan_change_requested", targetType: "Subscription", targetId: sub.id, meta: { from: sub.plan.key, to: plan.key, interval, immediate: false } }, tx);
    return { immediate: false, invoiceId: null, message: "Downgrade scheduled; the new plan applies at the next renewal." };
  });
}

export async function cancelSubscription(workspaceId: string, actorId: string, cancel = true) {
  const sub = await prisma.subscription.findUnique({ where: { workspaceId } });
  if (!sub) throw Errors.notFound("Subscription");
  await prisma.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: cancel, canceledAt: cancel ? new Date() : null } });
  await audit({ workspaceId, actorUserId: actorId, action: cancel ? "billing.cancel_scheduled" : "billing.cancel_reverted", targetType: "Subscription", targetId: sub.id });
}
