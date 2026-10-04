/**
 * Shared contracts for the scan-coordination layer (PRD §7, §9, §10).
 * The route talks to a ScanCoordinator; whether that is Upstash Redis or the
 * dev in-process fallback is resolved in index.ts (§10.4 failure policy).
 */

/** §9.3 X-RateLimit-Scope values. */
export type CapacityScope =
  | "ip"
  | "token"
  | "global"
  | "pipeline-daily"
  | "receipt-daily"
  | "background";

export interface CapacityDenial {
  ok: false;
  scope: CapacityScope;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export type Admission = { ok: true } | CapacityDenial;

/** The receipt outcome of a scan, carried on cached results and scanMeta. */
export type ReceiptAction = "appended" | "reused" | "none";

/** A completed scan response cached for the token cooldown window. */
export interface CachedScanResult {
  kind: "result";
  /** ISO timestamp of the fresh scan that produced this body. */
  scannedAt: string;
  /** The exact success response body (verdict, ledger, record) minus scanMeta. */
  body: Record<string, unknown>;
  receiptAction: ReceiptAction;
  /** Only complete results are cached, but the field keeps serves self-describing. */
  completeness: "complete" | "partial";
  /** DEX coverage of the cached verdict, so cache serves report §19.3 honestly. */
  dexProtocols: string[];
}

/** Short-lived marker that suppresses failure stampedes (§9.1 failure cache). */
export interface CachedScanFailure {
  kind: "failure";
  code: string;
  failedAt: string;
}

export type CachedScanEntry = CachedScanResult | CachedScanFailure;

export interface TokenLockAcquisition {
  acquired: boolean;
  /** Random ownership token; release is compare-and-delete (§10.3). */
  lockToken: string;
}

/** One usage/limit pair for the admin capacity view. `used === null` means the
 *  counter could not be read (coordinator unreachable), not zero. */
export interface CapacityGauge {
  used: number | null;
  limit: number;
}

/**
 * Read-only snapshot of the live capacity counters (§9, acceptance §24.15).
 * Never consumes budget — it exists so an operator can see remaining daily
 * headroom and current concurrency without running a scan.
 */
export interface CapacitySnapshot {
  coordinator: "redis" | "memory";
  /** False when the counters could not be read (Redis unreachable). */
  reachable: boolean;
  /** UTC day bucket the daily counters belong to (e.g. `2026-07-15`). */
  day: string;
  /** Fresh pipelines started today vs the daily cap. */
  pipelinesToday: CapacityGauge;
  /** New canonical receipts written today vs the daily cap. */
  receiptsToday: CapacityGauge;
  /** Pipelines running right now vs the concurrency cap. */
  activePipelines: CapacityGauge;
  /** Fresh-pipeline starts inside the current global burst window vs its cap. */
  globalBurst: CapacityGauge;
}

export interface ScanCoordinator {
  readonly kind: "redis" | "memory";
  /**
   * Atomically check and consume every fresh-pipeline budget (§9.2): IP burst,
   * IP daily, global burst, global concurrency, global daily pipelines.
   * Counters increment only when every check passes — no check-then-increment
   * race and no partial consumption on denial.
   */
  admitFreshPipeline(ipHash: string, nowMs: number): Promise<Admission>;
  /** Release the global concurrency slot taken by admitFreshPipeline. */
  releasePipelineSlot(): Promise<void>;
  /**
   * Background/cron admission (Group R M17), gated by its own
   * `SCAN_BACKGROUND_MAX_CONCURRENT` budget and tracked under its own
   * counter — entirely separate from `admitFreshPipeline`'s `globalActive`
   * gauge, so a background job can never consume the concurrency slot an
   * interactive scan checks against (and vice versa). `jobName` identifies
   * the caller for observability; the budget itself is a single shared
   * ceiling across all background jobs, not partitioned per job. This is a
   * primitive only — no caller in `lib/launches/*` or `app/api/jobs/*` wires
   * to it yet; that consumer-side adoption is a separate, already-in-progress
   * track.
   */
  admitBackgroundWork(jobName: string, nowMs: number): Promise<Admission>;
  /** Release the background concurrency slot taken by admitBackgroundWork. */
  releaseBackgroundWork(): Promise<void>;
  /**
   * Atomically reserve one daily canonical-receipt slot (§9.2). Returns true
   * when within the daily budget, false when exhausted. Only a materially-new
   * APPEND reserves; cooldown hits and REUSE never do. Fails OPEN on a Redis
   * fault — a sustained outage already blocks fresh scans at admission, so a
   * rare blip letting one extra receipt through beats losing a complete verdict.
   */
  reserveReceiptSlot(nowMs: number): Promise<boolean>;
  /** Give a reserved receipt slot back when the ledger append then fails (§9.2). */
  releaseReceiptSlot(nowMs: number): Promise<void>;
  acquireTokenLock(tokenAddress: string): Promise<TokenLockAcquisition>;
  releaseTokenLock(tokenAddress: string, lockToken: string): Promise<void>;
  /** Remaining lifetime of the token lock, for Retry-After on lock-wait expiry. */
  tokenLockTtlSeconds(tokenAddress: string): Promise<number | null>;
  /** Read the live capacity counters without consuming any budget (§24.15). */
  readCapacitySnapshot(nowMs: number): Promise<CapacitySnapshot>;
  readTokenResult(tokenAddress: string): Promise<CachedScanEntry | null>;
  writeTokenResult(
    tokenAddress: string,
    entry: CachedScanEntry,
    ttlSeconds: number
  ): Promise<void>;
}

/**
 * Thrown when coordination is configured but unreachable. Production fails
 * CLOSED for fresh pipelines (§10.4): no unlimited upstream work just because
 * Redis is down. Cached and database reads stay available.
 */
export class CoordinationUnavailableError extends Error {
  constructor(operation: string, cause?: unknown) {
    super(`scan coordination unavailable during ${operation}`);
    this.name = "CoordinationUnavailableError";
    this.cause = cause;
  }
}
