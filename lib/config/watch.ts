/**
 * The Watch (§4.3) — slow-rug monitor thresholds. Public and tunable so the
 * gradual-drain criteria are as auditable as the weighted checks.
 */
export const watchConfig = {
  /** Fraction of trailing-peak liquidity that must be gone to flag a drain. */
  drainThreshold: Number(process.env.WATCH_DRAIN_THRESHOLD ?? 0.7),
  /** Peak liquidity a pool must have reached for a drain to matter (USD). */
  minPeakUsd: Number(process.env.WATCH_MIN_PEAK_USD ?? 5_000),
  /** Trailing window for "peak", in days. */
  peakWindowDays: Number(process.env.WATCH_PEAK_WINDOW_DAYS ?? 7),
  /** Liquidity floor below which a pool counts as dead (mirrors rug criteria). */
  deadPoolUsd: 1_000,

  // ── pump-and-dump postmortem (§15.5) — the fast-window sibling ──
  /** Price (or liquidity) collapse from the trailing fast-window peak. */
  pumpDumpCollapsePct: Number(process.env.PUMP_DUMP_COLLAPSE_PCT ?? 0.95),
  /** Fast trailing window, in hours — the launch-to-dump danger window. */
  pumpDumpWindowHours: Number(process.env.PUMP_DUMP_WINDOW_HOURS ?? 72),

  // ── watch set sizing and candidate retention ──
  /** Maximum age of a token's latest verdict for watch candidacy (days). */
  watchMaxVerdictAgeDays: Number(process.env.WATCH_MAX_VERDICT_AGE_DAYS ?? 30),
  /** Maximum number of watched tokens monitored per hourly run. */
  watchMaxTokens: Number(process.env.WATCH_MAX_TOKENS ?? 600),
} as const;
