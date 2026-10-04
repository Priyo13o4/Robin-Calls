import type { ProviderEndpoint } from "./provider-pool";

/**
 * Per-provider CU / request-rate limiter (PRD §11.2, the "M9" milestone the
 * scheduler's module doc names).
 *
 * `ProviderEndpoint.maxCuPerSecond` and `.maxRequestsPerSecond` were parsed for
 * a long time but never enforced — the scheduler could only honor
 * `maxConcurrentRequests` (a per-instance ceiling by definition). This closes
 * that gap with a classic token bucket per provider: one bucket for compute
 * units, one for raw request rate, each refilling at its configured per-second
 * rate up to a one-second burst.
 *
 * `poolRequest` treats an over-budget provider exactly like one at its
 * concurrency ceiling: it is SKIPPED, not circuit-faulted. Budget exhaustion is
 * a queueing condition that resolves on its own as the bucket refills — the
 * pool's existing saturation-wait loop already models that, so a budget skip
 * rides the same bounded wait rather than burning fault-retry walks or opening
 * a breaker on a perfectly healthy provider.
 *
 * PROCESS-LOCAL, like the scheduler and circuit state. That is honest while
 * `SCAN_GLOBAL_MAX_CONCURRENT === 1` (the Valkey concurrency gate serializes
 * pipeline load globally). Raising it needs the cross-instance version: a
 * Valkey-backed bucket reusing lib/security/ratelimit.ts's atomic-Lua idiom.
 * The interface here (`tryAcquire`) is intentionally the shape that upgrade
 * would keep, so call sites don't change when it lands.
 */

/**
 * Approximate compute-unit weights per method (Alchemy's published CU table is
 * the de-facto standard and what Goldsky-class providers price against). Exact
 * values are not load-bearing — the point is that eth_getLogs is dramatically
 * heavier than a point read, so a burst of log-index fills throttles well
 * before a burst of eth_calls would. Unknown methods take DEFAULT_CU.
 */
const CU_COST: Record<string, number> = {
  eth_chainId: 0,
  net_version: 0,
  eth_blockNumber: 10,
  eth_gasPrice: 10,
  eth_getBlockByNumber: 16,
  eth_getBlockByHash: 21,
  eth_getBlockReceipts: 500,
  eth_getLogs: 75,
  eth_call: 26,
  eth_getCode: 19,
  eth_getStorageAt: 17,
  eth_getBalance: 19,
  eth_getTransactionReceipt: 15,
  eth_getTransactionByHash: 17,
  eth_getTransactionCount: 26,
  eth_estimateGas: 87,
  eth_simulateV1: 40,
};
const DEFAULT_CU = 20;

/** CU weight for one call of `method` (exported for tests / observability). */
export function cuCost(method: string): number {
  return CU_COST[method] ?? DEFAULT_CU;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export class CuLimiter {
  private readonly cuBuckets = new Map<string, Bucket>();
  private readonly reqBuckets = new Map<string, Bucket>();

  /**
   * Refill a bucket toward its one-second capacity by the elapsed time, then
   * return it. A never-seen provider starts full (a cold scan shouldn't be
   * throttled on its first call).
   */
  private refill(
    map: Map<string, Bucket>,
    id: string,
    ratePerSecond: number,
    nowMs: number,
  ): Bucket {
    let b = map.get(id);
    if (!b) {
      b = { tokens: ratePerSecond, lastRefillMs: nowMs };
      map.set(id, b);
      return b;
    }
    const elapsed = nowMs - b.lastRefillMs;
    if (elapsed > 0) {
      b.tokens = Math.min(ratePerSecond, b.tokens + (elapsed * ratePerSecond) / 1000);
      b.lastRefillMs = nowMs;
    }
    return b;
  }

  /**
   * Try to spend one request's budget on `endpoint`. Returns false when either
   * bucket is short — the caller then skips this provider (a wait, never a
   * fault). A provider with neither limit configured is unlimited.
   *
   * `nowMs` is injectable so token-bucket behavior is deterministic in tests;
   * production omits it and reads the clock.
   */
  tryAcquire(endpoint: ProviderEndpoint, method: string, nowMs: number = Date.now()): boolean {
    const cuMax = endpoint.maxCuPerSecond;
    const reqMax = endpoint.maxRequestsPerSecond;
    if (!cuMax && !reqMax) return true;

    const cuBucket = cuMax ? this.refill(this.cuBuckets, endpoint.id, cuMax, nowMs) : null;
    const reqBucket = reqMax ? this.refill(this.reqBuckets, endpoint.id, reqMax, nowMs) : null;

    // A single call can cost more than the whole per-second CU budget (e.g. a
    // 75-CU eth_getLogs against a 50 CU/s provider). Clamp the *threshold* to
    // capacity so such a call is admitted once the bucket is full rather than
    // deadlocking forever — but deduct the true cost, so it correctly borrows
    // from the next second (tokens go negative and take longer to refill).
    const cuNeed = cuMax ? Math.min(cuCost(method), cuMax) : 0;
    if (cuBucket && cuBucket.tokens < cuNeed) return false;
    if (reqBucket && reqBucket.tokens < 1) return false;

    if (cuBucket) cuBucket.tokens -= cuCost(method);
    if (reqBucket) reqBucket.tokens -= 1;
    return true;
  }

  /**
   * Milliseconds until both CU and request buckets hold enough tokens to admit
   * method on endpoint, without consuming any tokens.
   */
  msUntilAvailable(
    endpoint: ProviderEndpoint,
    method: string,
    nowMs: number = Date.now(),
  ): number {
    const cuMax = endpoint.maxCuPerSecond;
    const reqMax = endpoint.maxRequestsPerSecond;
    if (!cuMax && !reqMax) return 0;

    const cuBucket = cuMax ? this.refill(this.cuBuckets, endpoint.id, cuMax, nowMs) : null;
    const reqBucket = reqMax ? this.refill(this.reqBuckets, endpoint.id, reqMax, nowMs) : null;

    const cuNeed = cuMax ? Math.min(cuCost(method), cuMax) : 0;
    const cuShortfall = cuBucket && cuBucket.tokens < cuNeed ? cuNeed - cuBucket.tokens : 0;
    const cuMs = cuMax && cuShortfall > 0 ? Math.ceil((cuShortfall * 1000) / cuMax) : 0;

    const reqShortfall = reqBucket && reqBucket.tokens < 1 ? 1 - reqBucket.tokens : 0;
    const reqMs = reqMax && reqShortfall > 0 ? Math.ceil((reqShortfall * 1000) / reqMax) : 0;

    return Math.max(cuMs, reqMs);
  }
}

let limiter: CuLimiter | null = null;

/** Process-wide instance — one budget view per instance (see module doc). */
export function cuLimiter(): CuLimiter {
  if (!limiter) limiter = new CuLimiter();
  return limiter;
}

/** Test hook. */
export function resetCuLimiterForTests(): void {
  limiter = null;
}
