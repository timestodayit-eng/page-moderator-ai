import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";
import { env } from "../env";
import { Errors } from "../errors";

export interface StorageDriver {
  write(key: string, data: Buffer, contentType?: string): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** Private local storage (default). Keys are sanitised and kept under STORAGE_LOCAL_DIR. */
function localDriver(): StorageDriver {
  const root = path.resolve(env().STORAGE_LOCAL_DIR);
  const resolve = (key: string) => {
    const p = path.resolve(root, key.replace(/\.\./g, "").replace(/^\/+/, ""));
    if (!p.startsWith(root)) throw Errors.badRequest("Invalid storage key");
    return p;
  };
  return {
    async write(key, data) {
      const p = resolve(key);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, data);
    },
    read: (key) => readFile(resolve(key)),
    delete: (key) => unlink(resolve(key)).catch(() => {}),
  };
}

/** Cloudflare R2 via S3-compatible API with SigV4 (no SDK dependency). */
function r2Driver(): StorageDriver {
  const e = env();
  if (!e.R2_ACCOUNT_ID || !e.R2_ACCESS_KEY_ID || !e.R2_SECRET_ACCESS_KEY || !e.R2_BUCKET) throw Errors.notConfigured("Cloudflare R2 (R2_* variables)");
  const host = `${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const sign = (method: string, key: string, body: Buffer, contentType: string) => {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const payloadHash = createHash("sha256").update(body).digest("hex");
    const canonicalUri = `/${e.R2_BUCKET}/${encodeURIComponent(key).replace(/%2F/g, "/")}`;
    const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, ...(method === "PUT" ? { "content-type": contentType } : {}) };
    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonical = [method, canonicalUri, "", ...Object.keys(headers).sort().map((h) => `${h}:${headers[h]}`), "", signedHeaders, payloadHash].join("\n");
    const scope = `${date}/auto/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
    const kDate = createHmac("sha256", `AWS4${e.R2_SECRET_ACCESS_KEY}`).update(date).digest();
    const kRegion = createHmac("sha256", kDate).update("auto").digest();
    const kService = createHmac("sha256", kRegion).update("s3").digest();
    const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
    const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
    headers.Authorization = `AWS4-HMAC-SHA256 Credential=${e.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return { url: `https://${host}${canonicalUri}`, headers };
  };
  return {
    async write(key, data, contentType = "application/octet-stream") {
      const { url, headers } = sign("PUT", key, data, contentType);
      const res = await fetch(url, { method: "PUT", headers, body: new Uint8Array(data) });
      if (!res.ok) throw new Error(`R2 PUT failed ${res.status}`);
    },
    async read(key) {
      const { url, headers } = sign("GET", key, Buffer.alloc(0), "");
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`R2 GET failed ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async delete(key) {
      const { url, headers } = sign("DELETE", key, Buffer.alloc(0), "");
      await fetch(url, { method: "DELETE", headers });
    },
  };
}

let cached: StorageDriver | undefined;
export function storage(): StorageDriver {
  if (!cached) cached = env().STORAGE_DRIVER === "r2" ? r2Driver() : localDriver();
  return cached;
}
