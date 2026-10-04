import { Redis } from "ioredis";

/**
 * Single shared ioredis connection (TCP, RESP protocol) for the self-hosted
 * Valkey instance. Replaces @upstash/redis's REST client now that nothing
 * needs edge-runtime compatibility (proxy.ts runs on the Node.js runtime —
 * see next.config.ts).
 *
 * Graceful no-op mirrors the old Upstash behavior: unset REDIS_URL means
 * rate limiting and scan coordination degrade rather than crash.
 */

/**
 * Held on globalThis, not in module scope, for the same reason as the pg Pool
 * in lib/db/client.ts: the dev container mounts the working tree and hot
 * reloads, and every module re-evaluation would otherwise open a new Valkey
 * connection and leak the previous one until the socket limit is hit.
 */
const globalForRedis = globalThis as typeof globalThis & {
  robincallsRedis?: Redis | null;
};

export function redisUrl(): string | null {
  return process.env.REDIS_URL || null;
}

export function redisClient(): Redis | null {
  if (globalForRedis.robincallsRedis !== undefined) return globalForRedis.robincallsRedis;

  const url = redisUrl();
  if (!url) {
    globalForRedis.robincallsRedis = null;
    return null;
  }

  const client = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
  });
  client.on("error", () => {
    // Swallowed here — every call site already fails open/closed per its own
    // policy (see ratelimit.ts, redis-coordinator.ts). Logging every socket
    // blip would flood observability with noise ioredis itself retries past.
  });

  globalForRedis.robincallsRedis = client;
  return client;
}

/** Test hook: forget the resolved client so env changes take effect. */
export function resetRedisClientForTests(): void {
  globalForRedis.robincallsRedis = undefined;
}
