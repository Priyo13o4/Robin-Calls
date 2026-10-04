// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { TRACTION } from "./labels";

import type { LpCustodyLiveResult } from "@/lib/trade/lp-custody-shared";

export const PULL_CONFIRM_READINGS = 2;

export function prePullWalletWarning(result: LpCustodyLiveResult | null): string | null {
  throw new NotImplementedInPublicBuild("lib/launches/liquidity-pulled.ts#prePullWalletWarning");
}

export function liquidityPulled(i: {
  peakUsd: number | null;
  liquidityUsd: number | null;
  zeroReadings: number;
  removalLocked: boolean;
}): boolean {
  throw new NotImplementedInPublicBuild("lib/launches/liquidity-pulled.ts#liquidityPulled");
}