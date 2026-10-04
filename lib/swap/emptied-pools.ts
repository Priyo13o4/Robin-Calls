// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { parseAbi, type PublicClient } from "viem";

import { v4LiquiditySlot } from "../dex/v4-state-slot";

import { UNISWAP_V4_POOL_MANAGER } from "./venues";

import type { SwapPoolHint } from "./pool-hints";

import type { Address } from "./types";

export const MAX_EMPTY_CHECKS = 4;

export interface EmptiedPool {
  pool: Address;
  protocol: SwapPoolHint["protocol"];
  /** DexScreener's listed depth, which lags a removal by minutes: the reason we read the chain. */
  listedLiquidityUsd: number | null;
}

export { v4LiquiditySlot };

export async function readEmptiedPools(client: Pick<PublicClient, "readContract">, hints: readonly SwapPoolHint[], subject: Address): Promise<EmptiedPool[]> {
  throw new NotImplementedInPublicBuild("lib/swap/emptied-pools.ts#readEmptiedPools");
}