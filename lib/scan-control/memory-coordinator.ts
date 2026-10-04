import { randomUUID } from "crypto";
import { scanControlConfig, utcDayBucket } from "./config";
import type {
  Admission,
  CachedScanEntry,
  CapacitySnapshot,
  ScanCoordinator,
  TokenLockAcquisition,
} from "./types";

/**
 * In-process coordination fallback for development and DB-less demos
 * (PRD §10.4 "not configured at all"). Correct within a single Node process,
 * meaningless across serverless instances — which is why production without
 * Upstash disables fresh scans instead of using this class.
 */

interface WindowCounter {
  count: number;
  resetAtMs: number;
}

interface LockEntry {
  lockToken: string;
  expiresAtMs: number;
}

interface CacheEntry {
  entry: CachedScanEntry;
  expiresAtMs: number;
}

function bump(
  store: Map<string, WindowCounter>,
  key: string,
  windowSeconds: number,
  nowMs: number
): WindowCounter {
  const existing = store.get(key);
  if (!existing || existing.resetAtMs <= nowMs) {
    const fresh = { count: 1, resetAtMs: nowMs + windowSeconds * 1000 };
    store.set(key, fresh);
    return fresh;
  }
  existing.count += 1;
  return existing;
}

function peek(
  store: Map<string, WindowCounter>,
  key: string,
  nowMs: number
): WindowCounter | null {
  const existing = store.get(key);
  if (!existing || existing.resetAtMs <= nowMs) return null;
  return existing;
}

export class MemoryScanCoordinator implements ScanCoordinator {
  readonly kind = "memory" as const;

  private counters = new Map<string, WindowCounter>();
  private locks = new Map<string, LockEntry>();
  private results = new Map<string, CacheEntry>();
  private activePipelines = 0;
  // Independent from activePipelines (Group R M17) — background/cron
  // admission must never share a counter with interactive pipeline
  // concurrency, so exhausting one can never deny the other.
  private activeBackgroundWork = 0;

  async admitFreshPipeline(ipHash: string, nowMs: number): Promise<Admission> {
    const cfg = scanControlConfig();
    const day = utcDayBucket(nowMs);
    const dayWindowSeconds = 26 * 60 * 60;

    const gates: {
      key: string;
      windowSeconds: number;
      limit: number;
      scope: "ip" | "global" | "pipeline-daily";
    }[] = [
      { key: `ip:burst:${ipHash}`, windowSeconds: cfg.ipBurstWindowSeconds, limit: cfg.ipBurstLimit, scope: "ip" },
      { key: `ip:day:${day}:${ipHash}`, windowSeconds: dayWindowSeconds, limit: cfg.ipDailyLimit, scope: "ip" },
      { key: "global:burst", windowSeconds: cfg.globalBurstWindowSeconds, limit: cfg.globalBurstLimit, scope: "global" },
      { key: `global:pipelines:${day}`, windowSeconds: dayWindowSeconds, limit: cfg.globalDailyPipelineLimit, scope: "pipeline-daily" },
    ];

    for (const gate of gates) {
      const counter = peek(this.counters, gate.key, nowMs);
      if (counter && counter.count >= gate.limit) {
        return {
          ok: false,
          scope: gate.scope,
          limit: gate.limit,
          remaining: Math.max(0, gate.limit - counter.count),
          retryAfterSeconds: Math.max(1, Math.ceil((counter.resetAtMs - nowMs) / 1000)),
        };
      }
    }
    if (this.activePipelines >= cfg.globalMaxConcurrent) {
      return {
        ok: false,
        scope: "global",
        limit: cfg.globalMaxConcurrent,
        remaining: 0,
        retryAfterSeconds: cfg.lockTtlSeconds,
      };
    }

    for (const gate of gates) bump(this.counters, gate.key, gate.windowSeconds, nowMs);
    this.activePipelines += 1;
    return { ok: true };
  }

  async releasePipelineSlot(): Promise<void> {
    this.activePipelines = Math.max(0, this.activePipelines - 1);
  }

  /**
   * `jobName`/`nowMs` are accepted for interface parity with the Redis
   * coordinator (and future logging) but unused here: the in-process budget
   * is one shared ceiling across every background job, not per-job or
   * window-based.
   */
  async admitBackgroundWork(jobName: string, nowMs: number): Promise<Admission> {
    void jobName;
    void nowMs;
    const cfg = scanControlConfig();
    if (this.activeBackgroundWork >= cfg.backgroundMaxConcurrent) {
      return {
        ok: false,
        scope: "background",
        limit: cfg.backgroundMaxConcurrent,
        remaining: 0,
        retryAfterSeconds: cfg.lockTtlSeconds,
      };
    }
    this.activeBackgroundWork += 1;
    return { ok: true };
  }

  async releaseBackgroundWork(): Promise<void> {
    this.activeBackgroundWork = Math.max(0, this.activeBackgroundWork - 1);
  }

  async reserveReceiptSlot(nowMs: number): Promise<boolean> {
    const cfg = scanControlConfig();
    const key = `global:receipts:${utcDayBucket(nowMs)}`;
    const counter = peek(this.counters, key, nowMs);
    if (counter && counter.count >= cfg.globalDailyReceiptLimit) return false;
    bump(this.counters, key, 26 * 60 * 60, nowMs);
    return true;
  }

  async releaseReceiptSlot(nowMs: number): Promise<void> {
    const key = `global:receipts:${utcDayBucket(nowMs)}`;
    const counter = this.counters.get(key);
    if (counter) counter.count = Math.max(0, counter.count - 1);
  }

  async acquireTokenLock(tokenAddress: string): Promise<TokenLockAcquisition> {
    const cfg = scanControlConfig();
    const key = tokenAddress.toLowerCase();
    const now = Date.now();
    const existing = this.locks.get(key);
    if (existing && existing.expiresAtMs > now) {
      return { acquired: false, lockToken: "" };
    }
    const lockToken = randomUUID();
    this.locks.set(key, { lockToken, expiresAtMs: now + cfg.lockTtlSeconds * 1000 });
    return { acquired: true, lockToken };
  }

  async releaseTokenLock(tokenAddress: string, lockToken: string): Promise<void> {
    const key = tokenAddress.toLowerCase();
    const existing = this.locks.get(key);
    if (existing && existing.lockToken === lockToken) this.locks.delete(key);
  }

  async tokenLockTtlSeconds(tokenAddress: string): Promise<number | null> {
    const existing = this.locks.get(tokenAddress.toLowerCase());
    if (!existing) return null;
    const remaining = Math.ceil((existing.expiresAtMs - Date.now()) / 1000);
    return remaining > 0 ? remaining : null;
  }

  async readCapacitySnapshot(nowMs: number): Promise<CapacitySnapshot> {
    const cfg = scanControlConfig();
    const day = utcDayBucket(nowMs);
    const count = (key: string): number => peek(this.counters, key, nowMs)?.count ?? 0;
    return {
      coordinator: "memory",
      reachable: true,
      day,
      pipelinesToday: {
        used: count(`global:pipelines:${day}`),
        limit: cfg.globalDailyPipelineLimit,
      },
      receiptsToday: {
        used: count(`global:receipts:${day}`),
        limit: cfg.globalDailyReceiptLimit,
      },
      activePipelines: { used: this.activePipelines, limit: cfg.globalMaxConcurrent },
      globalBurst: { used: count("global:burst"), limit: cfg.globalBurstLimit },
    };
  }

  async readTokenResult(tokenAddress: string): Promise<CachedScanEntry | null> {
    const key = tokenAddress.toLowerCase();
    const cached = this.results.get(key);
    if (!cached) return null;
    if (cached.expiresAtMs <= Date.now()) {
      this.results.delete(key);
      return null;
    }
    return cached.entry;
  }

  async writeTokenResult(
    tokenAddress: string,
    entry: CachedScanEntry,
    ttlSeconds: number
  ): Promise<void> {
    this.results.set(tokenAddress.toLowerCase(), {
      entry,
      expiresAtMs: Date.now() + ttlSeconds * 1000,
    });
  }
}
