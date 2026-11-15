import { env } from "../env";
import { TEMPLATES } from "./templates";
import { prisma } from "../db";

export type RenderedEmail = { subject: string; html: string; text: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function interpolate(template: string, vars: Record<string, string | number | undefined>) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => (vars[k] === undefined || vars[k] === null ? "" : String(vars[k])));
}

export async function loadTemplate(key: string, locale: string) {
  const loc = locale.startsWith("bn") ? "bn" : "en";
  const fromDb = await prisma.emailTemplate.findFirst({ where: { key, locale: loc, isActive: true } }).catch(() => null);
  if (fromDb) return { subject: fromDb.subject, body: fromDb.body, ctaLabel: fromDb.ctaLabel ?? undefined, category: fromDb.category };
  const def = TEMPLATES.find((t) => t.key === key);
  if (!def) throw new Error(`Unknown email template: ${key}`);
  const t = def[loc as "en" | "bn"];
  return { ...t, category: def.category };
}

type Branding = { appName: string; brandColor: string; logoUrl?: string; footer?: string; supportEmail: string; appUrl: string };

export async function loadBranding(): Promise<Branding> {
  const row = await prisma.platformSetting.findUnique({ where: { key: "branding" } }).catch(() => null);
  const b = (row?.value ?? {}) as Partial<Branding>;
  return {
    appName: b.appName ?? env().APP_NAME,
    brandColor: b.brandColor ?? "#2563EB",
    logoUrl: b.logoUrl,
    footer: b.footer,
    supportEmail: b.supportEmail ?? env().EMAIL_SUPPORT_ADDRESS,
    appUrl: env().APP_URL,
  };
}

export function renderBody(body: string, vars: Record<string, string | number | undefined>, locale: string) {
  const text = interpolate(body, vars);
  const font = locale.startsWith("bn") ? "'Hind Siliguri', Inter, Arial, sans-serif" : "Inter, Arial, sans-serif";
  const blocks = text.split(/\n{2,}/).map((p) => {
    const trimmed = p.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("> "))
      return `<div style="margin:16px 0;padding:12px 16px;background:#F7F9FC;border-left:3px solid #2563EB;border-radius:8px;color:#4B5563;font-size:14px;line-height:1.6;font-family:${font}">${esc(trimmed.slice(2))}</div>`;
    return `<p style="margin:0 0 14px;color:#172033;font-size:15px;line-height:1.65;font-family:${font}">${esc(trimmed).replace(/\n/g, "<br/>")}</p>`;
  });
  return { html: blocks.join(""), text };
}

export async function renderEmail(key: string, locale: string, vars: Record<string, string | number | undefined>): Promise<RenderedEmail & { category: string }> {
  const [tpl, brand] = await Promise.all([loadTemplate(key, locale), loadBranding()]);
  const allVars = { appName: brand.appName, supportEmail: brand.supportEmail, appUrl: brand.appUrl, ...vars };
  const subject = interpolate(tpl.subject, allVars);
  const { html: bodyHtml, text: bodyText } = renderBody(tpl.body, allVars, locale);
  const cta = vars.ctaUrl ? { label: interpolate(tpl.ctaLabel ?? "Open", allVars), url: String(vars.ctaUrl) } : null;
  const unsub = vars.unsubscribeUrl ? `<p style="margin:12px 0 0;font-size:12px;color:#9CA3AF"><a href="${esc(String(vars.unsubscribeUrl))}" style="color:#9CA3AF">Unsubscribe from these emails</a></p>` : "";
  const businessName = vars.workspaceName ? `<div style="font-size:13px;color:#6B7280;margin-top:4px">${esc(String(vars.workspaceName))}</div>` : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#F7F9FC">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F7F9FC;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E5EAF1;border-radius:16px;overflow:hidden">
<tr><td style="padding:28px 32px 8px;font-family:Inter,Arial,sans-serif">
${brand.logoUrl ? `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.appName)}" height="32" style="height:32px;display:block"/>` : `<div style="font-weight:700;font-size:18px;color:#172033;letter-spacing:-0.2px"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${brand.brandColor};margin-right:8px"></span>${esc(brand.appName)}</div>`}
${businessName}
</td></tr>
<tr><td style="padding:16px 32px 8px">${bodyHtml}</td></tr>
${cta ? `<tr><td style="padding:8px 32px 24px"><a href="${esc(cta.url)}" style="display:inline-block;background:${brand.brandColor};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;font-family:Inter,Arial,sans-serif">${esc(cta.label)}</a><p style="margin:14px 0 0;font-size:12px;color:#9CA3AF;font-family:Inter,Arial,sans-serif;word-break:break-all">If the button does not work, copy this link: ${esc(cta.url)}</p></td></tr>` : ""}
<tr><td style="padding:16px 32px 24px;border-top:1px solid #E5EAF1;font-family:Inter,Arial,sans-serif;font-size:12px;color:#6B7280;line-height:1.6">
Need help? Contact <a href="mailto:${esc(brand.supportEmail)}" style="color:${brand.brandColor}">${esc(brand.supportEmail)}</a>.
${brand.footer ? `<br/>${esc(brand.footer)}` : ""}${unsub}
</td></tr></table>
</td></tr></table></body></html>`;

  const text = `${bodyText}\n\n${cta ? `${cta.label}: ${cta.url}\n\n` : ""}Support: ${brand.supportEmail}${vars.unsubscribeUrl ? `\nUnsubscribe: ${vars.unsubscribeUrl}` : ""}`;
  return { subject, html, text, category: tpl.category };
}
