// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { launchHookSet } from "./pool-origin";

import type { PoolRef } from "./types";

export const V4_DYNAMIC_FEE_FLAG = 0x800000;

export const UNTRADEABLE_LP_FEE = 500_000;

export function isUntradeableFee(fee: number | null | undefined): boolean {
  throw new NotImplementedInPublicBuild("lib/dex/pool-tradeability.ts#isUntradeableFee");
}

export function effectiveLpFee(keyFee: number | null | undefined, slot0LpFee?: number | null): number | null {
  throw new NotImplementedInPublicBuild("lib/dex/pool-tradeability.ts#effectiveLpFee");
}

export function isUntradeablePool(pool: Pick<PoolRef, "feeTier">): boolean {
  throw new NotImplementedInPublicBuild("lib/dex/pool-tradeability.ts#isUntradeablePool");
}

export function isLaunchSidePool(pool: { hooks?: string | null }): boolean {
  throw new NotImplementedInPublicBuild("lib/dex/pool-tradeability.ts#isLaunchSidePool");
}