// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { ScanContext } from "./checks";

export type VenueKind = "DEX" | "CURVE_ONLY" | "NONE";

export function curveTreatmentApplies(
  curve: { status?: string | null; createdAt?: string | null } | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  throw new NotImplementedInPublicBuild("lib/scanner/venue.ts#curveTreatmentApplies");
}

export function resolveVenue(input: {
  curveStatus?: string | null;
  curveCreatedAt?: string | null;
  hasDexPool: boolean;
  nowMs?: number;
}): VenueKind {
  throw new NotImplementedInPublicBuild("lib/scanner/venue.ts#resolveVenue");
}

export function isCurveOnlyVenue(
  ctx: {
    curve?: ScanContext["curve"];
    market?: ScanContext["market"];
    knownPools?: ScanContext["knownPools"];
    poolRefs?: ScanContext["poolRefs"];
  },
  nowMs: number = Date.now(),
): boolean {
  throw new NotImplementedInPublicBuild("lib/scanner/venue.ts#isCurveOnlyVenue");
}

export function curveVenueReason(
  check: "lp_custody" | "liquidity_depth" | "honeypot",
  launchpadName: string | null | undefined,
): string {
  throw new NotImplementedInPublicBuild("lib/scanner/venue.ts#curveVenueReason");
}
