// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { runSharedRpcWork } from "../observability/context";

import { UNISWAP_V4_POOL_MANAGER } from "./venues";

import { isAddress, type Abi } from "viem";

import { v2Factories, v3Factories } from "../config/dex-registry";

import type { PoolRef } from "../dex/types";

import { v2FactoryAbi, v2PairAbi, v3FactoryAbi, v3PoolAbi } from "../rpc/abis";

import { batchRead, type BatchCall } from "../rpc/multicall";

import { computeV4PoolId } from "./hook-admission";

import { readSwapV4PoolsByIds } from "../data/swap-pool-hints";

import { recoverV4PoolKeys } from "./v4-key-recovery";

import type { Address, Hex, SwapRequest } from "./types";

import { NATIVE } from "./types";

import { parseSwapPoolHints, type SwapPoolHint } from "./pool-hints";

import type { V4PoolKey } from "./ur-plan";

type Cached = { until: number; factory: Address; token0: Address; token1: Address; ref: PoolRef };

export interface ResolvedPoolHints {
  inputPools: PoolRef[];
  outputPools: PoolRef[];
  v4Keys: V4PoolKey[];
  /** Client-reported depth by lowercase pool address or V4 pool id; ranks quote attempts only. */
  liquidityUsd: Map<string, number>;
  faulted: boolean;
  unresolvedV4Ids: Hex[];
  usedHints: boolean;
}

interface ResolverDeps {
  batchRead?: typeof batchRead;
  readV4Pools?: typeof readSwapV4PoolsByIds;
  readV4ByIds?: typeof readSwapV4PoolsByIds;
  recoverV4?: typeof recoverV4PoolKeys;
  v2Factories?: typeof v2Factories;
  v3Factories?: typeof v3Factories;
}

type Req = Pick<SwapRequest, "tokenIn" | "tokenOut" | "poolHints">;

export async function resolvePoolHints(req: Req, deps: ResolverDeps = undefined as any): Promise<ResolvedPoolHints> {
  throw new NotImplementedInPublicBuild("lib/swap/pool-hint-resolution.ts#resolvePoolHints");
}

export function _resetPoolHintResolutionCacheForTests(): any {
  throw new NotImplementedInPublicBuild("lib/swap/pool-hint-resolution.ts#_resetPoolHintResolutionCacheForTests");
}