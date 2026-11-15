import { z } from "zod";

/**
 * Centralised, validated environment configuration.
 * In production the process refuses to start with missing or placeholder secrets
 * (a problem found in the previous prototype audit).
 */
const PLACEHOLDER = /(change[-_ ]?me|placeholder|example|xxx+|your[-_]|secret123|^test$|^dev$)/i;

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Deployment stage for strictness checks. `next start` forces NODE_ENV=production, so local smoke
  // tests of the production build can set APP_STAGE=local to relax https/placeholder enforcement.
  APP_STAGE: z.enum(["local", "staging", "production"]).optional(),
  APP_URL: z.url(),
  APP_NAME: z.string().default("Page Moderator AI"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  ENCRYPTION_KEY: z.string().min(1, "ENCRYPTION_KEY is required (32 bytes, base64)"),
  ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 14),
  SECURE_COOKIES: bool,
  TRUST_PROXY: bool,

  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  META_GRAPH_VERSION: z.string().default("v24.0"),
  META_SCOPES: z
    .string()
    .default("pages_show_list,pages_read_engagement,pages_read_user_content,pages_manage_engagement,pages_manage_metadata,pages_messaging"),
  META_AUTOMATION_ENABLED: bool, // global master switch: automatic Meta actions stay off until explicitly enabled

  DEFAULT_AI_PROVIDER: z.enum(["openai", "gemini", "deepseek"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  EMAIL_PROVIDER: z.enum(["smtp", "resend", "postmark", "disabled"]).default("smtp"),
  EMAIL_FROM: z.string().default("Page Moderator AI <no-reply@localhost>"),
  EMAIL_SUPPORT_ADDRESS: z.string().default("support@localhost"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  POSTMARK_SERVER_TOKEN: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  STORAGE_DRIVER: z.enum(["local", "r2"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof schema>;

export function validateEnv(source: NodeJS.ProcessEnv = process.env): { env?: Env; errors: string[] } {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const env = parsed.data;
  const errors: string[] = [];
  const key = Buffer.from(env.ENCRYPTION_KEY, "base64");
  if (key.length !== 32) errors.push("ENCRYPTION_KEY must decode (base64) to exactly 32 bytes. Generate: openssl rand -base64 32");

  const stage = env.APP_STAGE ?? (env.NODE_ENV === "production" ? "production" : "local");
  if (stage === "production" || stage === "staging") {
    const secrets: [string, string | undefined][] = [
      ["ENCRYPTION_KEY", env.ENCRYPTION_KEY],
      ["META_APP_SECRET", env.META_APP_SECRET],
      ["META_WEBHOOK_VERIFY_TOKEN", env.META_WEBHOOK_VERIFY_TOKEN],
      ["SMTP_PASS", env.SMTP_PASS],
      ["STRIPE_WEBHOOK_SECRET", env.STRIPE_WEBHOOK_SECRET],
    ];
    for (const [name, value] of secrets) {
      if (value && PLACEHOLDER.test(value)) errors.push(`${name} looks like a placeholder value — set a real secret`);
    }
    if (env.META_WEBHOOK_VERIFY_TOKEN && env.META_WEBHOOK_VERIFY_TOKEN.length < 16)
      errors.push("META_WEBHOOK_VERIFY_TOKEN must be at least 16 characters");
    if (stage === "production" && !env.APP_URL.startsWith("https://")) errors.push("APP_URL must use https:// in production");
    if (/postgres:postgres@/.test(env.DATABASE_URL)) errors.push("DATABASE_URL uses default postgres credentials");
  }
  return { env, errors };
}

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const { env: e, errors } = validateEnv();
  if (!e || errors.length) {
    const message = `Invalid environment configuration:\n - ${errors.join("\n - ")}`;
    throw new Error(message);
  }
  cached = e;
  return e;
}

export function resetEnvCache() {
  cached = undefined;
}

export const isMetaConfigured = () => Boolean(env().META_APP_ID && env().META_APP_SECRET);
