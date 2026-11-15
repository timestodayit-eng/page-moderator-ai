import { prisma } from "../db";
import { env } from "../env";
import { hmacSha256Hex, safeEqual } from "../crypto";
import { log } from "../log";
import { Errors } from "../errors";
import { enqueueOutbox } from "../queue/outbox";
import { paymentFailed, recordPayment } from "./lifecycle";

/**
 * Modular payment providers. `manual` is always available (bank transfer / bKash recorded by an admin after
 * confirmation). `stripe` is wired for Checkout Sessions + webhooks; add more by implementing PaymentProvider.
 */
export interface PaymentProvider {
  name: string;
  createCheckout(input: { invoiceId: string; amountCents: number; currency: string; description: string; successUrl: string; cancelUrl: string; customerEmail: string }): Promise<{ url: string; providerRef: string }>;
  verifyWebhook(rawBody: string, headers: Headers): { ok: boolean; event?: Record<string, unknown>; error?: string };
}

export const stripeProvider: PaymentProvider = {
  name: "stripe",
  async createCheckout(input) {
    const key = env().STRIPE_SECRET_KEY;
    if (!key) throw Errors.notConfigured("Stripe (STRIPE_SECRET_KEY)");
    const form = new URLSearchParams({
      mode: "payment",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      customer_email: input.customerEmail,
      "metadata[invoiceId]": input.invoiceId,
      "payment_intent_data[metadata][invoiceId]": input.invoiceId,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": input.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(input.amountCents),
      "line_items[0][price_data][product_data][name]": input.description,
    });
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `inv-${input.invoiceId}` }, body: form, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Stripe error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { id: string; url: string };
    return { url: data.url, providerRef: data.id };
  },
  verifyWebhook(rawBody, headers) {
    const secret = env().STRIPE_WEBHOOK_SECRET;
    if (!secret) return { ok: false, error: "STRIPE_WEBHOOK_SECRET not configured" };
    const sig = headers.get("stripe-signature") ?? "";
    const parts = Object.fromEntries(sig.split(",").map((p) => p.split("=") as [string, string]));
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1) return { ok: false, error: "malformed signature header" };
    if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return { ok: false, error: "timestamp outside tolerance" };
    const expected = hmacSha256Hex(secret, `${t}.${rawBody}`);
    if (!safeEqual(expected, v1)) return { ok: false, error: "signature mismatch" };
    try {
      return { ok: true, event: JSON.parse(rawBody) as Record<string, unknown> };
    } catch {
      return { ok: false, error: "invalid json" };
    }
  },
};

export function getProvider(name: string): PaymentProvider {
  if (name === "stripe") return stripeProvider;
  throw Errors.badRequest(`Unsupported payment provider: ${name}`);
}

export function availableProviders() {
  const list = ["manual"];
  if (env().STRIPE_SECRET_KEY) list.push("stripe");
  return list;
}

/** Store the verified webhook durably (dedupe on provider event id) and process asynchronously. */
export async function ingestBillingWebhook(provider: string, rawBody: string, headers: Headers) {
  const p = getProvider(provider);
  const v = p.verifyWebhook(rawBody, headers);
  if (!v.ok || !v.event) {
    log.warn("billing webhook rejected", { provider, error: v.error });
    throw Errors.forbidden("Invalid webhook signature");
  }
  const eventId = String(v.event.id ?? "");
  if (!eventId) throw Errors.badRequest("Missing event id");
  try {
    const stored = await prisma.$transaction(async (tx) => {
      const ev = await tx.webhookEvent.create({ data: { source: `billing:${provider}`, dedupeKey: `${provider}:${eventId}`, signatureValid: true, payload: v.event as object, status: "QUEUED" } });
      await enqueueOutbox("billing.webhook", { eventId: ev.id }, tx);
      return ev;
    });
    return { stored: stored.id };
  } catch (err) {
    if (err instanceof Error && /Unique constraint/i.test(err.message)) return { duplicate: true };
    throw err;
  }
}

export async function processBillingWebhookEvent(eventId: string) {
  const ev = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
  if (!ev || ev.status === "PROCESSED") return { skipped: true };
  await prisma.webhookEvent.update({ where: { id: eventId }, data: { status: "PROCESSING", attempts: { increment: 1 } } });
  try {
    const event = ev.payload as { type?: string; data?: { object?: Record<string, unknown> } };
    const obj = event.data?.object ?? {};
    const meta = (obj.metadata ?? {}) as { invoiceId?: string };
    if (ev.source === "billing:stripe") {
      if (event.type === "checkout.session.completed" && obj.payment_status === "paid" && meta.invoiceId) {
        await prisma.$transaction((tx) => recordPayment({ invoiceId: meta.invoiceId!, provider: "stripe", providerPaymentId: String(obj.payment_intent ?? obj.id), amountCents: Number(obj.amount_total ?? 0), currency: String(obj.currency ?? "usd").toUpperCase(), reference: String(obj.id), raw: { type: event.type } }, tx));
      } else if ((event.type === "payment_intent.payment_failed" || event.type === "checkout.session.async_payment_failed") && meta.invoiceId) {
        const reason = String((obj.last_payment_error as { message?: string } | undefined)?.message ?? "Payment failed");
        await prisma.$transaction((tx) => paymentFailed(meta.invoiceId!, reason, { type: event.type }, tx));
      }
    }
    await prisma.webhookEvent.update({ where: { id: eventId }, data: { status: "PROCESSED", processedAt: new Date() } });
    return { processed: event.type };
  } catch (err) {
    await prisma.webhookEvent.update({ where: { id: eventId }, data: { status: "FAILED", lastError: String(err).slice(0, 500) } });
    throw err;
  }
}
