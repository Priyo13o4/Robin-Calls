// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



export const Q96 = 1n << 96n;

export const MIN_TICK = -887272;

export const MAX_TICK = 887272;

export const MIN_SQRT_RATIO = 4295128739n;

export const MAX_SQRT_RATIO = 0 as any;

export function getSqrtRatioAtTick(tick: number): bigint {
  throw new NotImplementedInPublicBuild("lib/launches/modules/v4-math.ts#getSqrtRatioAtTick");
}

export interface PositionAmounts {
  amount0: bigint;
  amount1: bigint;
}

export function getAmountsForLiquidity(liquidity: bigint, sqrtPriceX96: bigint, tickLower: number, tickUpper: number): PositionAmounts {
  throw new NotImplementedInPublicBuild("lib/launches/modules/v4-math.ts#getAmountsForLiquidity");
}

export function calculateBondFillBps(assetLeft: bigint, totalTokens: bigint): number {
  throw new NotImplementedInPublicBuild("lib/launches/modules/v4-math.ts#calculateBondFillBps");
}