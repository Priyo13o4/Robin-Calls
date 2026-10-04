// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



export interface QuoteSizeImpactInput {
  protocols: readonly ("v2" | "v3" | "v4")[];
  /** Pool identities for the selected full-size route, in execution order. */
  fullPoolIds: readonly string[];
  /** Must be the identical ordered pool path used by the small reference quote. */
  referencePoolIds: readonly string[];
  fullAmountIn: bigint;
  fullAmountOut: bigint;
  referenceAmountIn: bigint;
  referenceAmountOut: bigint;
  /** Every V4 pool on the path is hookless, so its price moves only with the curve. */
  v4Hookless?: true;
}

export type QuoteSizeImpactResult =
  | { status: "measured"; bps: number; referenceFraction: "1%" }
  | { status: "unavailable"; reason: string };

export const PRICE_IMPACT_WARNING_BPS = 500;

export function isLargeEstimatedPriceImpact(bps: number | null | undefined): boolean {
  throw new NotImplementedInPublicBuild("lib/swap/price-impact.ts#isLargeEstimatedPriceImpact");
}

export function estimateQuoteSizeImpact(input: QuoteSizeImpactInput): QuoteSizeImpactResult {
  throw new NotImplementedInPublicBuild("lib/swap/price-impact.ts#estimateQuoteSizeImpact");
}