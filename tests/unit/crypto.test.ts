import { describe, expect, it } from "vitest";
import { decrypt, encrypt, generateToken, safeEqual, sha256 } from "@/server/crypto";
import { redact } from "@/server/log";
import { memoryHit, _resetMemoryLimiter } from "@/server/ratelimit";
import { validateEnv } from "@/server/env";

describe("crypto", () => {
  it("round-trips AES-256-GCM and rejects tampering", () => {
    const ct = encrypt("EAAB-super-secret-token");
    expect(ct.startsWith("v1.")).toBe(true);
    expect(decrypt(ct)).toBe("EAAB-super-secret-token");
    const parts = ct.split(".");
    parts[4] = parts[4].slice(0, -2) + "AA";
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("produces unique tokens and stable hashes", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(sha256(a)).toBe(sha256(a));
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
  });
});

describe("log redaction", () => {
  it("redacts secret keys and token-like values", () => {
    const out = redact({ password: "x", nested: { access_token: "y" }, msg: "token EAABwzLixnjYBAOZCZC1234567890abcdefgh and sk-abcdefghijklmnopqrstuvwxyz" }) as Record<string, unknown>;
    expect(out.password).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).access_token).toBe("[redacted]");
    expect(String(out.msg)).not.toContain("EAABwzLixnjYBAOZCZC1234567890");
    expect(String(out.msg)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });
});

describe("rate limiter memory fallback", () => {
  it("blocks after the limit and resets after the window", () => {
    _resetMemoryLimiter();
    const now = Date.now();
    for (let i = 0; i < 3; i++) expect(memoryHit("k", 3, 60, now).allowed).toBe(true);
    const blocked = memoryHit("k", 3, 60, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(memoryHit("k", 3, 60, now + 61_000).allowed).toBe(true);
  });
});

describe("env validation", () => {
  const base = { NODE_ENV: "production", APP_URL: "https://app.example.com", DATABASE_URL: "postgresql://pm:strongpw@db:5432/pm", ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };
  it("rejects placeholder secrets in production", () => {
    const { errors } = validateEnv({ ...base, META_APP_SECRET: "change-me", META_WEBHOOK_VERIFY_TOKEN: "placeholder-token-123" } as NodeJS.ProcessEnv);
    expect(errors.some((e) => e.includes("META_APP_SECRET"))).toBe(true);
    expect(errors.some((e) => e.includes("META_WEBHOOK_VERIFY_TOKEN"))).toBe(true);
  });
  it("rejects bad encryption keys and http in production", () => {
    const { errors } = validateEnv({ ...base, APP_URL: "http://app.example.com", ENCRYPTION_KEY: "short" } as NodeJS.ProcessEnv);
    expect(errors.some((e) => e.includes("ENCRYPTION_KEY"))).toBe(true);
    expect(errors.some((e) => e.includes("https://"))).toBe(true);
  });
  it("accepts a sane production config", () => {
    const { errors } = validateEnv({ ...base, META_APP_SECRET: "a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4", META_WEBHOOK_VERIFY_TOKEN: "k3j4h5g6f7d8s9a0q1w2e3r4" } as NodeJS.ProcessEnv);
    expect(errors).toEqual([]);
  });
});
