// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { runSharedRpcWork } from "../observability/context";

import { factCache } from "./fact-cache";

import { ROBINHOOD_CHAIN_ID } from "../config/chain";

import { WETH, UNISWAP_UR, PANCAKE_INFINITY_UR, profileForDex, type UniversalRouterProfile } from "./venues";

import { USDG } from "./plan-context";

import { NATIVE, type Address, type SwapFamily } from "./types";

import type { PoolRef } from "../dex/types";

import { discoverCustodyPools, type CustodyDiscovery } from "../dex/discovery";

type DiscoveryOptions = Parameters<typeof discoverCustodyPools>[2];

export function cachedDiscovery(token: `0x${string}`, bridges: readonly string[], options: DiscoveryOptions, discover: any = undefined as any): Promise<CustodyDiscovery> {
  throw new NotImplementedInPublicBuild("lib/swap/multihop-discovery.ts#cachedDiscovery");
}

export function _resetDiscoveryCacheForTests(): any {
  throw new NotImplementedInPublicBuild("lib/swap/multihop-discovery.ts#_resetDiscoveryCacheForTests");
}

export const CHAIN_BRIDGES = {
  [ROBINHOOD_CHAIN_ID]: [
    WETH.toLowerCase() as Address,
    USDG.toLowerCase() as Address,
  ],
} as const;

export function getBridgesForChain(chainId: number): readonly Address[] {
  throw new NotImplementedInPublicBuild("lib/swap/multihop-discovery.ts#getBridgesForChain");
}

export interface MultihopCandidatePools {
  bridge: Address;
  family: SwapFamily;
  protocol: "v2" | "v3";
  profile: UniversalRouterProfile;
  leg1Pool: PoolRef;
  leg2Pool: PoolRef;
  leg1Protocol?: "v2" | "v3";
  leg2Protocol?: "v2" | "v3";
}

export interface MultihopDiscoveryResult {
  candidates: MultihopCandidatePools[];
  /** Unpruned Uniswap V3 endpoint pools retained for mixed V3/V4 path search. */
  endpointPools?: { tokenIn: PoolRef[]; tokenOut: PoolRef[] };
  searchComplete: boolean;
  unsearched: string[];
  prunedCount: number;
}

export interface MultihopDiscoveryDeps {
  discoverCustodyPools?: (token: `0x${string}`, customQuotes?: readonly string[], options?: { includeCl?: boolean; dexIds?: readonly string[]; v3FeeTiersByDex?: Readonly<Record<string, readonly number[]>> }) => Promise<CustodyDiscovery>;
  extraBridges?: readonly Address[];
  extraBridgesComplete?: boolean;
  extraBridgesUnsearched?: string[];
  endpointPools?: { tokenIn: PoolRef[]; tokenOut: PoolRef[] };
}

export async function discoverMultihopRoutes(tokenIn: Address, tokenOut: Address, chainId: number = undefined as any, deps: MultihopDiscoveryDeps = undefined as any): Promise<MultihopDiscoveryResult> {
  throw new NotImplementedInPublicBuild("lib/swap/multihop-discovery.ts#discoverMultihopRoutes");
}