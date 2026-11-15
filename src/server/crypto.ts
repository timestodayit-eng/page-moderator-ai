import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Authenticated encryption (AES-256-GCM) for credentials at rest: Meta Page tokens, BYOK AI keys,
 * MFA secrets and one-time email variables. Format: v1.<keyId>.<iv>.<tag>.<ciphertext> (base64url).
 * Supports key rotation via ENCRYPTION_KEY_PREVIOUS.
 */
function keyFrom(b64: string) {
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes");
  return key;
}
function keyId(key: Buffer) {
  return createHash("sha256").update(key).digest("base64url").slice(0, 8);
}

export function encrypt(plaintext: string): string {
  const key = keyFrom(env().ENCRYPTION_KEY);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", keyId(key), iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(payload: string): string {
  const [version, kid, ivB64, tagB64, ctB64] = payload.split(".");
  if (version !== "v1" || !kid || !ivB64 || !tagB64 || ctB64 === undefined) throw new Error("Malformed ciphertext");
  const candidates = [env().ENCRYPTION_KEY, env().ENCRYPTION_KEY_PREVIOUS].filter(Boolean) as string[];
  for (const b64 of candidates) {
    const key = keyFrom(b64);
    if (keyId(key) !== kid) continue;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
  }
  throw new Error("No matching encryption key for ciphertext");
}

export function encryptJson(value: unknown) {
  return encrypt(JSON.stringify(value));
}
export function decryptJson<T>(payload: string): T {
  return JSON.parse(decrypt(payload)) as T;
}

/** Cryptographically secure URL-safe token. Only its hash is ever stored. */
export function generateToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacSha256Hex(secret: string, data: string | Buffer) {
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function last4(secret: string) {
  return secret.slice(-4);
}
