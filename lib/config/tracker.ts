/**
 * Launch Tracker thresholds (PRD §7.7 / v3 §7.4). Deterministic surfacing —
 * a token appears on /tracker only when it crosses a real traction bar, never
 * on deployment alone. "Surfaced on traction, not on deployment."
 *
 * No AI/heuristics-with-a-model here: these are hard numeric gates, on-brand
 * with "Code, not oracle. Every score can be re-derived by anyone." Plain
 * exported constants, deliberately not env-tunable — an env var isn't visible
 * in the code an outside reader is re-deriving the gate from.
 *
 * Raised 2026-08-30 (from $5k/$10k, no tx floor): a DEX_RESTRICTED launch
 * clears the OLD bar the moment its own deployer drops $5k of liquidity in —
 * one transaction, no organic trading required — which is a materially
 * weaker bar than BONDING_CURVE's own gate (33% real curve-buying progress,
 * CURVE_POLL.bondingSurfaceBps). The tx-count floor is what actually raises
 * the cost of gaming this: liquidity/volume alone can be one wash-traded
 * block; a real minimum trade count needs sustained, repeated activity.
 */
export const TRACKER_THRESHOLDS = {
  /** Minimum deepest-pool liquidity (USD) for a launch to surface at all. */
  minLiquidityUsd: 20_000,
  /** OR: 24h volume this high surfaces a token even below the liquidity bar. */
  minVolume24hUsd: 40_000,
  /**
   * AND, always: buys + sells over the same 24h window this pool's
   * liquidity/volume was read from. Both DexScreener and GeckoTerminal
   * already return this in the same request used for liquidity/volume — it
   * is not a second traction dimension, it is a floor against fabricating
   * the first one. A missing count fails this exactly like a missing
   * liquidity/volume figure fails the OR gate above: unmeasured and
   * measured-zero both mean "cannot surface this," on purpose (this gate
   * decides public visibility, not an accusation — §4's unknown-vs-negative
   * split governs the scanner's verdicts, not this one).
   */
  minTxCount24h: 20,
} as const;

export type TriggerMetric = "LIQUIDITY" | "VOLUME";
