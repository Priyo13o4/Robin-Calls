// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";

export interface PositionEvent {
  key: string;
  tickLower: number;
  tickUpper: number;
  delta: bigint;
  block: number;
  logIndex: number;
}

export interface ValuedFlow {
  basis: "value-at-current-price" | "single-range-liquidity";
  startValue: number;
  peakValue: number;
  nowValue: number;
  freshValue: number;
  withdrawnPct: number;
  freshPct: number;
}

export function sqrtPriceAtTick(tick: number): number {
  throw new NotImplementedInPublicBuild("lib/dex/pool-value.ts#sqrtPriceAtTick");
}

export function rangeValue(
  liquidity: number,
  tickLower: number,
  tickUpper: number,
  sqrtP: number,
): number {
  throw new NotImplementedInPublicBuild("lib/dex/pool-value.ts#rangeValue");
}

export function valuePoolFlow(
  events: readonly PositionEvent[],
  currentTick: number | null,
  fromBlock: number | null,
): ValuedFlow | null {
  throw new NotImplementedInPublicBuild("lib/dex/pool-value.ts#valuePoolFlow");
}
