import nodemailer from "nodemailer";
import { env } from "../env";
import { Errors } from "../errors";

export type SendInput = { to: string; subject: string; html: string; text: string; category: string; headers?: Record<string, string> };
export type SendResult = { provider: string; messageId: string };

export interface EmailProvider {
  name: string;
  send(input: SendInput): Promise<SendResult>;
  verify?(): Promise<void>;
}

function smtpProvider(): EmailProvider {
  const e = env();
  if (!e.SMTP_HOST) throw Errors.notConfigured("SMTP (SMTP_HOST)");
  const transporter = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_SECURE,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined,
    pool: true,
    maxConnections: 3,
  });
  return {
    name: "smtp",
    async send(input) {
      const info = await transporter.sendMail({ from: e.EMAIL_FROM, to: input.to, subject: input.subject, html: input.html, text: input.text, headers: input.headers });
      return { provider: "smtp", messageId: info.messageId };
    },
    verify: () => transporter.verify().then(() => undefined),
  };
}

function resendProvider(): EmailProvider {
  const e = env();
  if (!e.RESEND_API_KEY) throw Errors.notConfigured("Resend (RESEND_API_KEY)");
  return {
    name: "resend",
    async send(input) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: e.EMAIL_FROM, to: [input.to], subject: input.subject, html: input.html, text: input.text, headers: input.headers }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Resend error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { id: string };
      return { provider: "resend", messageId: data.id };
    },
  };
}

function postmarkProvider(): EmailProvider {
  const e = env();
  if (!e.POSTMARK_SERVER_TOKEN) throw Errors.notConfigured("Postmark (POSTMARK_SERVER_TOKEN)");
  return {
    name: "postmark",
    async send(input) {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: { "X-Postmark-Server-Token": e.POSTMARK_SERVER_TOKEN!, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          From: e.EMAIL_FROM,
          To: input.to,
          Subject: input.subject,
          HtmlBody: input.html,
          TextBody: input.text,
          MessageStream: input.category === "MARKETING" ? "broadcast" : "outbound",
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Postmark error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { MessageID: string };
      return { provider: "postmark", messageId: data.MessageID };
    },
  };
}

const disabledProvider: EmailProvider = {
  name: "disabled",
  async send() {
    throw Errors.notConfigured("Email provider (EMAIL_PROVIDER=disabled)");
  },
};

let cached: EmailProvider | undefined;
export function emailProvider(): EmailProvider {
  if (cached) return cached;
  switch (env().EMAIL_PROVIDER) {
    case "smtp":
      cached = smtpProvider();
      break;
    case "resend":
      cached = resendProvider();
      break;
    case "postmark":
      cached = postmarkProvider();
      break;
    default:
      cached = disabledProvider;
  }
  return cached;
}

export function isEmailEnabled() {
  const e = env();
  if (e.EMAIL_PROVIDER === "disabled") return false;
  if (e.EMAIL_PROVIDER === "smtp") return Boolean(e.SMTP_HOST);
  if (e.EMAIL_PROVIDER === "resend") return Boolean(e.RESEND_API_KEY);
  if (e.EMAIL_PROVIDER === "postmark") return Boolean(e.POSTMARK_SERVER_TOKEN);
  return false;
}

export function _resetEmailProvider() {
  cached = undefined;
}
