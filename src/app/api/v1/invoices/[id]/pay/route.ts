import { z } from "zod";
import { api } from "@/server/http";
import { prisma } from "@/server/db";
import { Errors } from "@/server/errors";
import { getProvider } from "@/server/billing/providers";
import { appLink } from "@/server/email/service";

/** Starts a hosted checkout for an open invoice. Payment is only recorded when the provider's webhook confirms it. */
export const POST = api({ permission: "billing.manage", body: z.object({ provider: z.string().default("stripe") }) }, async ({ ws, params, body }) => {
  const inv = await prisma.invoice.findFirst({ where: { id: params.id, workspaceId: ws!.workspace.id } });
  if (!inv) throw Errors.notFound("Invoice");
  if (inv.status !== "OPEN") throw Errors.conflict("Invoice is not open");
  const provider = getProvider(body.provider);
  const checkout = await provider.createCheckout({ invoiceId: inv.id, amountCents: inv.totalCents, currency: inv.currency, description: `${ws!.workspace.name} — ${inv.number}`, successUrl: appLink(`/app/${ws!.workspace.slug}/billing?paid=${inv.number}`), cancelUrl: appLink(`/app/${ws!.workspace.slug}/billing`), customerEmail: ws!.user.email });
  await prisma.invoice.update({ where: { id: inv.id }, data: { provider: provider.name, providerInvoiceId: checkout.providerRef } });
  return { url: checkout.url };
});
