import { readSiteConfigKeys } from "../data/site-config";
import { TOTAL_WEIGHT, UNREAD_SURFACE_WEIGHT_DEFAULT } from "./formula";

/**
 * LP-custody thresholds, editable at /admin/settings.
 *
 * These are formula inputs, so moving one moves published scores with no
 * FORMULA_VERSION change to explain it — CLAUDE.md §9's "a score that moved
 * without the chain moving". The mitigation is mandatory, not optional:
 * `custodyThresholds()` is recorded into every custody evidence bundle
 * (`effectiveThresholds`), so a diff of two receipts always shows which dial
 * moved. Do not read these values anywhere that does not also publish them.
 */

export interface CustodyThresholds {
  /** A single actor's PULLABLE share at which the pool is theirs to rug. */
  deployerMaterialPct: number;
  /** Same line for a non-deployer holder (§15.10 holds them to one standard). */
  pullerMaterialPct: number;
  /**
   * Protected share at which BURNED/LOCKED becomes the headline, among pools
   * where nothing material is pullable. `decideCustodyState` tests it AFTER
   * both danger rungs precisely so it cannot flip a status — put it back above
   * them and the decay-through-a-cliff bug returns.
   */
  protectedHeadlinePct: number;
  /** Attribution below which an all-clear is not earned (§15.10 coverage gate). */
  coverageMinPct: number;
}

export const CUSTODY_THRESHOLD_DEFAULTS: CustodyThresholds = {
  deployerMaterialPct: 0.05,
  pullerMaterialPct: 0.05,
  protectedHeadlinePct: 0.9,
  coverageMinPct: 0.9,
};

export const CUSTODY_THRESHOLD_KEYS = {
  deployerMaterialPct: "custody_deployer_material_pct",
  pullerMaterialPct: "custody_puller_material_pct",
  protectedHeadlinePct: "custody_protected_headline_pct",
  coverageMinPct: "custody_coverage_min_pct",
} as const satisfies Record<keyof CustodyThresholds, string>;

/**
 * A1's unread-surface cap threshold, in WEIGHT not share — hence its own key,
 * its own parser and a separate cache from the share dials above. Lives here so
 * one `primeCustodyThresholds()` loads every operator-tunable formula input.
 */
export const UNREAD_SURFACE_WEIGHT_KEY = "unread_surface_weight_threshold";

let unreadWeightCache: number | null = null;

/**
 * Bounded by `TOTAL_WEIGHT`, not a literal: a threshold above the whole
 * surface could never fire and 0 would fire on every scan, and both are
 * rejected to the default rather than accepted, because a silently unfireable
 * cap is indistinguishable from a cap that is working. Deriving the bound means
 * a future weight change cannot desync the validator from the surface.
 */
export function parseWeightThreshold(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > TOTAL_WEIGHT) return fallback;
  return n;
}

export function setUnreadSurfaceWeightThreshold(value: number | null): void {
  unreadWeightCache = value;
}

export function unreadSurfaceWeightThreshold(): number {
  return unreadWeightCache ?? UNREAD_SURFACE_WEIGHT_DEFAULT;
}

let cache: { value: CustodyThresholds; loadedAt: number } | null = null;
const TTL_MS = 60_000;

/**
 * A share must be a real number in (0, 1]. A malformed row keeps the default
 * rather than propagating NaN into a comparison — `NaN >= x` is false, which
 * would silently disable a danger rung.
 */
export function parseShare(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 1) return fallback;
  return n;
}

/** Install thresholds directly. Used by primeCustodyThresholds and unit tests. */
export function setCustodyThresholds(value: CustodyThresholds): void {
  cache = { value, loadedAt: Date.now() };
}

/**
 * Load thresholds from site_config into the module cache. The adapters read
 * them synchronously deep inside their loops, so the DB read happens once up
 * front — same contract as primeTrustedLockers().
 */
export async function primeCustodyThresholds(): Promise<void> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return;
  // A config read must not be able to kill a scan. This runs inside the
  // ingestion `Promise.all`, where every other member has its own catch and
  // `primeTrustedLockers` cannot reject — an unguarded rejection here would
  // turn a transient Postgres blip into a failed verdict.
  const rows = await readSiteConfigKeys([
    ...Object.values(CUSTODY_THRESHOLD_KEYS),
    UNREAD_SURFACE_WEIGHT_KEY,
  ]).catch((): Record<string, string> => ({}));
  setUnreadSurfaceWeightThreshold(
    parseWeightThreshold(rows[UNREAD_SURFACE_WEIGHT_KEY], UNREAD_SURFACE_WEIGHT_DEFAULT),
  );
  setCustodyThresholds({
    deployerMaterialPct: parseShare(rows[CUSTODY_THRESHOLD_KEYS.deployerMaterialPct], CUSTODY_THRESHOLD_DEFAULTS.deployerMaterialPct),
    pullerMaterialPct: parseShare(rows[CUSTODY_THRESHOLD_KEYS.pullerMaterialPct], CUSTODY_THRESHOLD_DEFAULTS.pullerMaterialPct),
    protectedHeadlinePct: parseShare(rows[CUSTODY_THRESHOLD_KEYS.protectedHeadlinePct], CUSTODY_THRESHOLD_DEFAULTS.protectedHeadlinePct),
    coverageMinPct: parseShare(rows[CUSTODY_THRESHOLD_KEYS.coverageMinPct], CUSTODY_THRESHOLD_DEFAULTS.coverageMinPct),
  });
}

/**
 * The thresholds in force. Falls back to the code defaults before priming and
 * in DB-less mode, which CLAUDE.md §1 treats as a supported local state — the
 * alternative is a scan that cannot decide custody at all without a database.
 */
export function custodyThresholds(): CustodyThresholds {
  return cache?.value ?? CUSTODY_THRESHOLD_DEFAULTS;
}

/** Only the dials that differ from the shipped defaults. Empty is the norm. */
export function overriddenThresholds(): Partial<CustodyThresholds> {
  const active = custodyThresholds();
  const out: Partial<CustodyThresholds> = {};
  for (const k of Object.keys(CUSTODY_THRESHOLD_DEFAULTS) as (keyof CustodyThresholds)[]) {
    if (active[k] !== CUSTODY_THRESHOLD_DEFAULTS[k]) out[k] = active[k];
  }
  return out;
}
