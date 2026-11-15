/**
 * Structured JSON logger with secret redaction. Never logs tokens, passwords or API keys.
 */
const SECRET_KEYS = /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|access_token|keyEnc|tokenEnc|varsEnc)/i;
const SECRET_VALUES = [
  /EAA[A-Za-z0-9]{20,}/g, // Meta access tokens
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI / DeepSeek keys
  /AIza[0-9A-Za-z_-]{20,}/g, // Google API keys
  /(reset-password|verify-email|invite)\?token=[A-Za-z0-9_-]+/g,
];

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") {
    let out = value;
    for (const re of SECRET_VALUES) out = out.replace(re, (m) => m.slice(0, 6) + "…[redacted]");
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  const min = (process.env.LOG_LEVEL as Level) || "info";
  if (order[level] < order[min]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(redact(fields ?? {}) as object) });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => emit("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit("error", msg, f),
};
