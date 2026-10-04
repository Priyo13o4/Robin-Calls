import { LAUNCH_LIFECYCLE } from "@/lib/config/launches";
import { TRACKER_THRESHOLDS } from "@/lib/config/tracker";
import type { LauncherFamily, VenueKind } from "./types";

/**
 * Labels are computed when reading, never stored (ARCHITECTURE.md §6.4). A token
 * past the window falls out by arithmetic on an immutable creation time.
 */

/** Night Market Bonding tab floor: a live fill reading at or above 33%. */
export const BONDING_SURFACE_BPS = 3_300;

export const LABEL_WINDOW_MS = LAUNCH_LIFECYCLE.retentionDays * 24 * 60 * 60 * 1000;

/** Families that launch straight into a pool: no raise, no fill. */
export const POOL_FAMILIES: ReadonlySet<LauncherFamily> = new Set(["pons-v1", "party-v1", "cashcat-v1", "direct-dex"]);

export type ProvenanceStatus = "CURVING" | "GRADUATED" | "STALLED";

/**
 * The status the scanner's venue gate reads. A pool launch is born GRADUATED
 * (its market is a DEX pool). A curve older than the window with no graduation
 * is STALLED, and an unknown age is not young (L156). Never RUGGED: a curve's
 * price falling is holders selling, not a pull.
 */
export function provenanceStatus(input: {
  venueKind: VenueKind;
  graduated: boolean;
  createdAtMs: number | null;
  nowMs: number;
}): ProvenanceStatus {
  if (input.venueKind === "POOL" || input.graduated) return "GRADUATED";
  if (input.createdAtMs === null) return "STALLED";
  return input.nowMs - input.createdAtMs > LABEL_WINDOW_MS ? "STALLED" : "CURVING";
}

/** The pad's venue model as the scanner and Night Market name it. null = not a pad. */
export function venueModelOf(family: string, venueKind: VenueKind): "BONDING_CURVE" | "DEX_RESTRICTED" | null {
  if (family === "direct-dex") return null;
  return venueKind === "POOL" ? "DEX_RESTRICTED" : "BONDING_CURVE";
}

/** A direct DEX launch shows only once it has real traction (lib/config/tracker.ts). */
export const TRACTION = {
  minLiquidityUsd: TRACKER_THRESHOLDS.minLiquidityUsd,
  minVolume24hUsd: TRACKER_THRESHOLDS.minVolume24hUsd,
  minTxCount24h: TRACKER_THRESHOLDS.minTxCount24h,
} as const;
