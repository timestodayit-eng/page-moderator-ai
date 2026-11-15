import { z } from "zod";
import { api } from "@/server/http";
import { sendTestEmail } from "@/server/platform/admin";
import { renderEmail } from "@/server/email/render";
import { appLink } from "@/server/email/service";

/** POST { preview: true } returns rendered HTML without sending. */
export const POST = api({ auth: "platform", body: z.object({ to: z.email().optional(), templateKey: z.string(), locale: z.enum(["en", "bn"]).default("en"), vars: z.record(z.string(), z.string()).default({}), preview: z.boolean().default(false) }) }, async ({ user, body }) => {
  if (body.preview) {
    const r = await renderEmail(body.templateKey, body.locale, { name: "Test Recipient", workspaceName: "Example Business", ctaUrl: appLink("/"), ...body.vars });
    return { subject: r.subject, html: r.html, text: r.text };
  }
  if (!body.to) throw new Error("Recipient required");
  const d = await sendTestEmail(user!.id, { to: body.to, templateKey: body.templateKey, locale: body.locale, vars: body.vars });
  return { delivery: { id: d.id, status: d.status, lastError: d.lastError } };
});
