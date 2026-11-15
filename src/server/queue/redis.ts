import IORedis, { type Redis } from "ioredis";
import { env } from "../env";

let bullConn: Redis | undefined;
let fastConn: Redis | undefined;

/** Connection for BullMQ (blocking commands, unlimited retries). */
export function bullConnection(): Redis {
  if (!bullConn) bullConn = new IORedis(env().REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
  return bullConn;
}

/** Fail-fast connection for rate limiting / locks: errors immediately instead of queueing while Redis is down. */
export function fastRedis(): Redis {
  if (!fastConn) {
    fastConn = new IORedis(env().REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
      lazyConnect: false,
    });
    fastConn.on("error", () => {});
  }
  return fastConn;
}

export async function closeRedis() {
  await Promise.allSettled([bullConn?.quit(), fastConn?.quit()]);
  bullConn = undefined;
  fastConn = undefined;
}
