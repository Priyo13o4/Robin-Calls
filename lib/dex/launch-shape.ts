// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



export interface LaunchShapePrimitives {
  /** The pool's tick at (or immediately after) initialization. */
  poolInitTick: number;
  /** The candidate launch mint's range. */
  mintTickLower: number;
  mintTickUpper: number;
  /** Raw Mint event amounts, in the pool's own token0/token1 order. */
  mintAmount0: bigint;
  mintAmount1: bigint;
  /** Does the SCANNED token sort as token0 in this pool? */
  tokenIsToken0: boolean;
  /** Uniswap's usable-tick ceiling for this pool's tick spacing
   *  (floor(887272 / tickSpacing) * tickSpacing) — NOT the raw TickMath.MAX_TICK,
   *  which is rarely itself a usable tick. */
  maxUsableTick: number;
}

export type LaunchShapeLabel = "single-sided-full-supply-v3-seed";

export interface LaunchShapeRecognition {
  matched: boolean;
  label: LaunchShapeLabel | null;
}

export function classifyLaunchShape(p: LaunchShapePrimitives): LaunchShapeRecognition {
  throw new NotImplementedInPublicBuild("lib/dex/launch-shape.ts#classifyLaunchShape");
}

export function tickSpacingForFeeTier(feeTier: number): number | null {
  throw new NotImplementedInPublicBuild("lib/dex/launch-shape.ts#tickSpacingForFeeTier");
}

export function maxUsableTick(tickSpacing: number | null): number | null {
  throw new NotImplementedInPublicBuild("lib/dex/launch-shape.ts#maxUsableTick");
}