import type { Redis } from "ioredis";
import {
  DAY_KEY_TTL_SECONDS,
  scanControlConfig,
  utcDayBucket,
} from "./config";
import {
  CoordinationUnavailableError,
  type Admission,
  type CachedScanEntry,
  type CapacityScope,
  type CapacitySnapshot,
  type ScanCoordinator,
  type TokenLockAcquisition,
} from "./types";
import { ROBINHOOD_CHAIN_ID } from "../config/chain";

/**
 * Valkey-backed scan coordination (PRD §10), via ioredis (TCP/RESP). Keys
 * carry an explicit schema version and UTC bucket (§10.2); all multi-step
 * operations are single Lua scripts so there is no check-then-increment race
 * (§10.3). Every key has a bounded TTL — Valkey holds only short-lived
 * operational state and can be flushed without losing receipts.
 */

const keys = {
  ipBurst: (ipHash: string) => `rc:v1:scan:ip:burst:${ipHash}`,
  ipDay: (day: string, ipHash: string) => `rc:v1:scan:ip:day:${day}:${ipHash}`,
  globalBurst: "rc:v1:scan:global:burst",
  globalActive: "rc:v1:scan:global:active",
  // Independent from globalActive (Group R M17) — background/cron admission
  // must never share a counter with interactive pipeline concurrency.
  backgroundActive: "rc:v1:scan:background:active",
  globalPipelinesDay: (day: string) => `rc:v1:scan:global:pipelines:${day}`,
  globalReceiptsDay: (day: string) => `rc:v1:scan:global:receipts:${day}`,
  tokenLock: (token: string) =>
    `rc:v1:scan:token:lock:${ROBINHOOD_CHAIN_ID}:${token.toLowerCase()}`,
  tokenResult: (token: string) =>
    `rc:v1:scan:token:result:${ROBINHOOD_CHAIN_ID}:${token.toLowerCase()}`,
};

/**
 * Check every budget, then consume every budget — one atomic script.
 * Denial: {0, scope, limit, current, pttlMs}. Admission: {1}.
 * The active gauge's TTL refreshes on each acquire so a crashed instance
 * frees its slot within SCAN_LOCK_TTL_SECONDS + margin.
 */
const ADMIT_SCRIPT = `
local function deny(scope, limit, current, key, fallbackTtl)
  local pttl = redis.call('PTTL', key)
  if pttl < 0 then pttl = fallbackTtl * 1000 end
  return {0, scope, limit, current, pttl}
end
local ipBurstLimit = tonumber(ARGV[1])
local ipBurstWindow = tonumber(ARGV[2])
local ipDailyLimit = tonumber(ARGV[3])
local dayTtl = tonumber(ARGV[4])
local gBurstLimit = tonumber(ARGV[5])
local gBurstWindow = tonumber(ARGV[6])
local maxConcurrent = tonumber(ARGV[7])
local activeTtl = tonumber(ARGV[8])
local dailyPipelineLimit = tonumber(ARGV[9])

local ipBurst = tonumber(redis.call('GET', KEYS[1]) or '0')
if ipBurst >= ipBurstLimit then
  return deny('ip', ipBurstLimit, ipBurst, KEYS[1], ipBurstWindow)
end
local ipDay = tonumber(redis.call('GET', KEYS[2]) or '0')
if ipDay >= ipDailyLimit then
  return deny('ip', ipDailyLimit, ipDay, KEYS[2], dayTtl)
end
local gBurst = tonumber(redis.call('GET', KEYS[3]) or '0')
if gBurst >= gBurstLimit then
  return deny('global', gBurstLimit, gBurst, KEYS[3], gBurstWindow)
end
local gActive = tonumber(redis.call('GET', KEYS[4]) or '0')
if gActive >= maxConcurrent then
  return deny('global', maxConcurrent, gActive, KEYS[4], activeTtl)
end
local gDay = tonumber(redis.call('GET', KEYS[5]) or '0')
if gDay >= dailyPipelineLimit then
  return deny('pipeline-daily', dailyPipelineLimit, gDay, KEYS[5], dayTtl)
end

local function bump(key, ttl)
  if redis.call('INCR', key) == 1 then redis.call('EXPIRE', key, ttl) end
end
bump(KEYS[1], ipBurstWindow)
bump(KEYS[2], dayTtl)
bump(KEYS[3], gBurstWindow)
redis.call('INCR', KEYS[4])
redis.call('EXPIRE', KEYS[4], activeTtl)
bump(KEYS[5], dayTtl)
return {1}
`;

/**
 * Background/cron admission (Group R M17) — a single-gate variant of
 * ADMIT_SCRIPT scoped to its own counter (`backgroundActive`) so it can
 * never read or consume the interactive `globalActive` gauge, and
 * `admitFreshPipeline` can never read or consume this one. Same
 * check-then-consume-atomically shape, deliberately not reusing
 * ADMIT_SCRIPT's multi-gate script since none of the IP/burst/daily gates
 * apply to background work.
 */
const ADMIT_BACKGROUND_SCRIPT = `
local maxConcurrent = tonumber(ARGV[1])
local activeTtl = tonumber(ARGV[2])
local active = tonumber(redis.call('GET', KEYS[1]) or '0')
if active >= maxConcurrent then
  local pttl = redis.call('PTTL', KEYS[1])
  if pttl < 0 then pttl = activeTtl * 1000 end
  return {0, 'background', maxConcurrent, active, pttl}
end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], activeTtl)
return {1}
`;

/** Decrement the active gauge without letting a double-release go negative. */
const RELEASE_SLOT_SCRIPT = `
local c = redis.call('DECR', KEYS[1])
if c < 0 then redis.call('SET', KEYS[1], '0', 'KEEPTTL') end
return c
`;

/** Reserve a daily receipt slot: {1} within budget, {0} exhausted (§9.2). */
const RESERVE_RECEIPT_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local cur = tonumber(redis.call('GET', key) or '0')
if cur >= limit then return 0 end
if redis.call('INCR', key) == 1 then redis.call('EXPIRE', key, ttl) end
return 1
`;

/** Compare-and-delete: only the ownership token that locked may unlock (§10.3). */
const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

type AdmitReply = [1] | [0, string, number, number, number];

export class RedisScanCoordinator implements ScanCoordinator {
  readonly kind = "redis" as const;

  constructor(private readonly redis: Redis) {}

  /** Fail closed on Redis faults for admission/locking paths (§10.4). */
  private async guarded<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (cause) {
      throw new CoordinationUnavailableError(operation, cause);
    }
  }

  async admitFreshPipeline(ipHash: string, nowMs: number): Promise<Admission> {
    const cfg = scanControlConfig();
    const day = utcDayBucket(nowMs);
    const evalKeys = [
      keys.ipBurst(ipHash),
      keys.ipDay(day, ipHash),
      keys.globalBurst,
      keys.globalActive,
      keys.globalPipelinesDay(day),
    ];
    const reply = await this.guarded("admitFreshPipeline", () =>
      this.redis.eval(
        ADMIT_SCRIPT,
        evalKeys.length,
        ...evalKeys,
        cfg.ipBurstLimit,
        cfg.ipBurstWindowSeconds,
        cfg.ipDailyLimit,
        DAY_KEY_TTL_SECONDS,
        cfg.globalBurstLimit,
        cfg.globalBurstWindowSeconds,
        cfg.globalMaxConcurrent,
        cfg.lockTtlSeconds + 15, // active slot outlives the longest lock
        cfg.globalDailyPipelineLimit
      )
    ) as AdmitReply;

    if (reply[0] === 1) return { ok: true };
    const [, scope, limit, current, pttlMs] = reply;
    return {
      ok: false,
      scope: scope as CapacityScope,
      limit,
      remaining: Math.max(0, limit - current),
      retryAfterSeconds: Math.max(1, Math.ceil(pttlMs / 1000)),
    };
  }

  async releasePipelineSlot(): Promise<void> {
    // Best-effort: a missed release self-heals via the gauge TTL.
    await this.redis
      .eval(RELEASE_SLOT_SCRIPT, 1, keys.globalActive)
      .catch(() => undefined);
  }

  /**
   * `jobName` is not folded into the Redis key: the budget is one shared
   * ceiling across every background job (curve-poll, tracker-poll,
   * slow-rug, anchor, lineage-trace, log-retention, wanted-ingest, ...), not
   * a per-job allowance. It is accepted here so a future caller can log or
   * report which job was admitted/denied.
   */
  async admitBackgroundWork(jobName: string, nowMs: number): Promise<Admission> {
    void jobName;
    void nowMs;
    const cfg = scanControlConfig();
    const reply = (await this.guarded("admitBackgroundWork", () =>
      this.redis.eval(
        ADMIT_BACKGROUND_SCRIPT,
        1,
        keys.backgroundActive,
        cfg.backgroundMaxConcurrent,
        cfg.lockTtlSeconds + 15
      )
    )) as AdmitReply;

    if (reply[0] === 1) return { ok: true };
    const [, scope, limit, current, pttlMs] = reply;
    return {
      ok: false,
      scope: scope as CapacityScope,
      limit,
      remaining: Math.max(0, limit - current),
      retryAfterSeconds: Math.max(1, Math.ceil(pttlMs / 1000)),
    };
  }

  async releaseBackgroundWork(): Promise<void> {
    // Best-effort: a missed release self-heals via the gauge TTL, same as
    // releasePipelineSlot.
    await this.redis
      .eval(RELEASE_SLOT_SCRIPT, 1, keys.backgroundActive)
      .catch(() => undefined);
  }

  async reserveReceiptSlot(nowMs: number): Promise<boolean> {
    const cfg = scanControlConfig();
    const day = utcDayBucket(nowMs);
    try {
      const reply = (await this.redis.eval(
        RESERVE_RECEIPT_SCRIPT,
        1,
        keys.globalReceiptsDay(day),
        cfg.globalDailyReceiptLimit,
        DAY_KEY_TTL_SECONDS
      )) as number;
      return reply === 1;
    } catch {
      // Fail OPEN (§9.2): a Redis blip must not sink a complete verdict.
      return true;
    }
  }

  async releaseReceiptSlot(nowMs: number): Promise<void> {
    const day = utcDayBucket(nowMs);
    // Best-effort: a missed release only over-counts one receipt for the day.
    await this.redis
      .eval(RELEASE_SLOT_SCRIPT, 1, keys.globalReceiptsDay(day))
      .catch(() => undefined);
  }

  async acquireTokenLock(tokenAddress: string): Promise<TokenLockAcquisition> {
    const cfg = scanControlConfig();
    const lockToken = crypto.randomUUID();
    const set = await this.guarded("acquireTokenLock", () =>
      this.redis.set(
        keys.tokenLock(tokenAddress),
        lockToken,
        "EX",
        cfg.lockTtlSeconds,
        "NX"
      )
    );
    return { acquired: set === "OK", lockToken };
  }

  async releaseTokenLock(tokenAddress: string, lockToken: string): Promise<void> {
    // Best-effort: on failure the lock's own TTL frees the token.
    await this.redis
      .eval(RELEASE_LOCK_SCRIPT, 1, keys.tokenLock(tokenAddress), lockToken)
      .catch(() => undefined);
  }

  async tokenLockTtlSeconds(tokenAddress: string): Promise<number | null> {
    try {
      const ttl = await this.redis.ttl(keys.tokenLock(tokenAddress));
      return ttl > 0 ? ttl : null;
    } catch {
      return null;
    }
  }

  async readCapacitySnapshot(nowMs: number): Promise<CapacitySnapshot> {
    const cfg = scanControlConfig();
    const day = utcDayBucket(nowMs);
    try {
      // Single round-trip, read-only — no counter is touched. ioredis mget
      // always returns raw strings (or null), unlike Upstash's auto-parsed
      // values — parse here instead of trusting the wire type.
      const [pipelines, receipts, active, burst] = await this.redis.mget(
        keys.globalPipelinesDay(day),
        keys.globalReceiptsDay(day),
        keys.globalActive,
        keys.globalBurst
      );
      const n = (v: string | null): number => {
        const parsed = Number.parseInt(v ?? "", 10);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      return {
        coordinator: "redis",
        reachable: true,
        day,
        pipelinesToday: { used: n(pipelines), limit: cfg.globalDailyPipelineLimit },
        receiptsToday: { used: n(receipts), limit: cfg.globalDailyReceiptLimit },
        activePipelines: { used: n(active), limit: cfg.globalMaxConcurrent },
        globalBurst: { used: n(burst), limit: cfg.globalBurstLimit },
      };
    } catch {
      // Unreachable: report unknown counts rather than a misleading zero.
      return {
        coordinator: "redis",
        reachable: false,
        day,
        pipelinesToday: { used: null, limit: cfg.globalDailyPipelineLimit },
        receiptsToday: { used: null, limit: cfg.globalDailyReceiptLimit },
        activePipelines: { used: null, limit: cfg.globalMaxConcurrent },
        globalBurst: { used: null, limit: cfg.globalBurstLimit },
      };
    }
  }

  async readTokenResult(tokenAddress: string): Promise<CachedScanEntry | null> {
    // Fail OPEN: an unreadable cache is a miss; the DB pointer still serves.
    try {
      const raw = await this.redis.get(keys.tokenResult(tokenAddress));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedScanEntry;
      if (parsed.kind !== "result" && parsed.kind !== "failure") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async writeTokenResult(
    tokenAddress: string,
    entry: CachedScanEntry,
    ttlSeconds: number
  ): Promise<void> {
    // Best-effort: a missed cache write only costs the next request a DB read.
    await this.redis
      .set(keys.tokenResult(tokenAddress), JSON.stringify(entry), "EX", ttlSeconds)
      .catch(() => undefined);
  }
}
