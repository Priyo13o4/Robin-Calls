// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { SwapPoolHint } from "./pool-hints";

import type { Address, RouteAdvice, RouteHopMetadata } from "./types";

export const HIGH_POOL_FEE_PIPS = 10_000;

export const MAIN_PRICE_GAP_BPS = 300;

export function highPoolFeeBps(hops: readonly Pick<RouteHopMetadata, "feeTier">[]): number | null {
  throw new NotImplementedInPublicBuild("lib/swap/route-advice.ts#highPoolFeeBps");
}

export function withPoolFee(impactBps: number | null, poolFeeBps: number): number {
  throw new NotImplementedInPublicBuild("lib/swap/route-advice.ts#withPoolFee");
}

export function deepestListedPool(hints: readonly SwapPoolHint[], subject: Address): SwapPoolHint | null {
  throw new NotImplementedInPublicBuild("lib/swap/route-advice.ts#deepestListedPool");
}

export const STICKY_ROUTE_BPS = 50n;

export function routeKeyOf(venue: string, pools: readonly (string | null | undefined)[]): string {
  throw new NotImplementedInPublicBuild("lib/swap/route-advice.ts#routeKeyOf");
}

export function stickyWeight(key: string, preferred: ReadonlySet<string>): bigint {
  throw new NotImplementedInPublicBuild("lib/swap/route-advice.ts#stickyWeight");
}

export function routeAdvice(input: {
  hints: readonly SwapPoolHint[];
  unresolvedV4Ids: readonly string[];
  subject: Address;
  payAsset: Address;
  routePools: readonly (string | null | undefined)[];
  approvedBridges?: readonly Address[];
}): RouteAdvice[] {
  throw new NotImplementedInPublicBuild("lib/swap/route-advice.ts#routeAdvice");
}