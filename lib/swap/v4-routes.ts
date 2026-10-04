// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { readSwapV4Pools } from "../data/swap-pools";

import { quote as quoteV4 } from "../dex/v4-sim";

import { assessHookForSwap, computeV4PoolId } from "./hook-admission";

import { ZIA_BRIDGE_REVIEWED_HOOK } from "./reviewed-hooks";

import { USDG, type Candidate } from "./plan-context";

import type { V4PoolKey } from "./ur-plan";

import { UNISWAP_UR, UNISWAP_V4_POOL_MANAGER, WETH } from "./venues";

import { NATIVE, type Address, type ExcludedVenue } from "./types";

import { v4PoolCurrency } from "./v4-plan";

import { swapClient } from "./read-client";

import { resolveQuoteRoute } from "../dex/registry";

import { quoteV3ExactInputSingle } from "../dex/v3-quoter";

import type { PoolRef } from "../dex/types";

export const DUST_USD = 100;

export interface V3PoolCandidate {
  pool: Address;
  feeTier: number;
  token0: Address;
  token1: Address;
}

export interface V4RouteDeps {
  readPools?: typeof readSwapV4Pools;
  quote?: typeof quoteV4;
  assessHook?: typeof assessHookForSwap;
  quoteV3?: (pool: PoolRef, tokenIn: Address, tokenOut: Address, amountIn: bigint) => Promise<bigint>;
}

export interface V4RouteRequest {
  tokenIn: Address; tokenOut: Address; amountIn: bigint;
  /** Independently resolved graduation keys, not arbitrary caller pool hints. */
  authenticatedKeys: readonly V4PoolKey[];
  /** Hinted pools whose key was proven to hash to the hinted id (pool-hint-resolution.ts). */
  hintKeys?: readonly V4PoolKey[];
  /** Pool depth by lowercase V3 address or V4 id; orders paths before the MAX_PATHS cut. */
  liquidityUsd?: ReadonlyMap<string, number>;
  allowTwoHop: boolean;
  /** Direct pool identities already priced by the existing planner. */
  alreadyQuoted?: ReadonlySet<string>;
  v3Pools?: readonly V3PoolCandidate[];
  extraBridges?: readonly Address[];
}

export async function quoteCatalogueV4Routes(req: V4RouteRequest, deps: V4RouteDeps = undefined as any): Promise<{
  candidates: Candidate[]; excluded: ExcludedVenue[]; quoteCalls: number; v3QuoteCalls: number; pruned: number;
}> {
  throw new NotImplementedInPublicBuild("lib/swap/v4-routes.ts#quoteCatalogueV4Routes");
}