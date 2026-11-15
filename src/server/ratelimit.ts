import { fastRedis } from "./queue/redis";
import { log } from "./log";

/**
 * Fixed-window rate limiter backed by Redis.
 * If Redis is unavailable we fall back to a per-process in-memory window — limits are NEVER
 * silently disabled (the prototype failed open when Redis errored).
 */
const memory = new Map<string, { count: number; resetAt: number }>();

export type RateResult = { allowed: boolean; remaining: number; retryAfter: number; backend: "redis" | "memory" };

export function memoryHit(key: string, limit: number, windowSec: number, now = Date.now()): RateResult {
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    if (memory.size > 50_000) for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
    return { allowed: true, remaining: limit - 1, retryAfter: 0, backend: "memory" };
  }
  entry.count += 1;
  const allowed = entry.count <= limit;
  return { allowed, remaining: Math.max(0, limit - entry.count), retryAfter: allowed ? 0 : Math.ceil((entry.resetAt - now) / 1000), backend: "memory" };
}

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateResult> {
  const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  try {
    const r = fastRedis();
    if (r.status !== "ready") throw new Error(`redis ${r.status}`);
    const res = await r.multi().incr(bucket).expire(bucket, windowSec + 1).exec();
    const count = Number(res?.[0]?.[1] ?? 0);
    const allowed = count <= limit;
    return { allowed, remaining: Math.max(0, limit - count), retryAfter: allowed ? 0 : windowSec, backend: "redis" };
  } catch (err) {
    log.warn("rate limiter falling back to memory", { err: String(err) });
    return memoryHit(key, limit, windowSec);
  }
}

export function _resetMemoryLimiter() {
  memory.clear();
}
