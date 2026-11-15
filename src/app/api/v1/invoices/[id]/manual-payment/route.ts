import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { Errors } from "@/server/errors";
import { recordPayment } from "@/server/billing/lifecycle";

/** Super Admin records an offline payment (bank transfer / bKash) after verifying it. */
export const POST = api({ auth: "platform", body: z.object({ amountCents: z.number().int().positive(), currency: z.string().length(3).default("USD"), reference: z.string().min(2).max(120), method: z.string().max(40).default("bank") }) }, async ({ user, params, body }) => {
  const inv = await prisma.invoice.findUnique({ where: { id: params.id } });
  if (!inv) throw Errors.notFound("Invoice");
  if (inv.status !== "OPEN") throw Errors.conflict("Invoice is not open");
  const res = await prisma.$transaction((tx) => recordPayment({ invoiceId: inv.id, provider: "manual", providerPaymentId: `${body.method}:${body.reference}`, amountCents: body.amountCents, currency: body.currency.toUpperCase(), recordedById: user!.id, reference: body.reference }, tx));
  return { duplicate: res.duplicate, paymentId: res.payment.id };
});
