/**
 * Scan-capacity configuration (PRD §9.1). Every limit is an environment
 * variable with a safe launch default — never a hard-coded product constant.
 * Values are read at call time so tests and emergency env changes apply
 * without a rebuild; the reads are trivial string parses.
 */

function intEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface ScanControlConfig {
  /** Fresh-pipeline attempts allowed per IP inside the burst window. */
  ipBurstLimit: number;
  ipBurstWindowSeconds: number;
  /** Fresh-pipeline attempts per IP per UTC day. */
  ipDailyLimit: number;
  /** Serve the recent complete verdict for the same token inside this window. */
  tokenCooldownSeconds: number;
  globalBurstLimit: number;
  globalBurstWindowSeconds: number;
  /** Active upstream pipelines at once. Raise only after §11.2 load testing. */
  globalMaxConcurrent: number;
  /**
   * Active background/cron admissions at once (Group R M17), e.g. curve
   * tracker polling. Tracked under its own counter so background work can
   * never consume the interactive `globalMaxConcurrent` slot budget — kept
   * conservative because these jobs walk logs across a shared RPC provider
   * pool that interactive scans also depend on.
   */
  backgroundMaxConcurrent: number;
  globalDailyPipelineLimit: number;
  globalDailyReceiptLimit: number;
  canonicalMaxAgeSeconds: number;
  materialLiquidityChangePct: number;
  /** Crash-safe token-lock lifetime; also bounds the leaked-slot window. */
  lockTtlSeconds: number;
  /** How long a second requester waits for the in-flight winner's result. */
  lockWaitSeconds: number;
  resultCacheSeconds: number;
  /** Short suppression of provider-failure stampedes. */
  failureCacheSeconds: number;
}

export function scanControlConfig(): ScanControlConfig {
  return {
    ipBurstLimit: intEnv("SCAN_IP_BURST_LIMIT", 3),
    ipBurstWindowSeconds: intEnv("SCAN_IP_BURST_WINDOW_SECONDS", 600),
    ipDailyLimit: intEnv("SCAN_IP_DAILY_LIMIT", 25),
    tokenCooldownSeconds: intEnv("SCAN_TOKEN_COOLDOWN_SECONDS", 600),
    globalBurstLimit: intEnv("SCAN_GLOBAL_BURST_LIMIT", 5),
    globalBurstWindowSeconds: intEnv("SCAN_GLOBAL_BURST_WINDOW_SECONDS", 60),
    globalMaxConcurrent: intEnv("SCAN_GLOBAL_MAX_CONCURRENT", 1),
    backgroundMaxConcurrent: intEnv("SCAN_BACKGROUND_MAX_CONCURRENT", 1),
    globalDailyPipelineLimit: intEnv("SCAN_GLOBAL_DAILY_PIPELINE_LIMIT", 250),
    globalDailyReceiptLimit: intEnv("SCAN_GLOBAL_DAILY_RECEIPT_LIMIT", 100),
    canonicalMaxAgeSeconds: intEnv("SCAN_CANONICAL_MAX_AGE_SECONDS", 21_600),
    materialLiquidityChangePct: intEnv("SCAN_MATERIAL_LIQUIDITY_CHANGE_PCT", 10),
    // Must outlive the 180s terminal scan deadline, otherwise another caller
    // can acquire this token's lock while the original pipeline still runs.
    lockTtlSeconds: intEnv("SCAN_LOCK_TTL_SECONDS", 210),
    lockWaitSeconds: intEnv("SCAN_LOCK_WAIT_SECONDS", 20),
    resultCacheSeconds: intEnv("SCAN_RESULT_CACHE_SECONDS", 900),
    failureCacheSeconds: intEnv("SCAN_FAILURE_CACHE_SECONDS", 60),
  };
}

/** UTC day bucket used in daily counter keys: `2026-07-14`. */
export function utcDayBucket(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** TTL that safely outlives its UTC-day key (date scoping does the precision). */
export const DAY_KEY_TTL_SECONDS = 26 * 60 * 60;
