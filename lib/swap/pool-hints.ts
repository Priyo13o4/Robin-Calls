// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { isAddress } from "viem";

import type { Address } from "./types";

export interface SwapPoolHint {
  pool: Address;
  protocol: "v2" | "v3" | "v4";
  token0: Address;
  token1: Address;
  /** DexScreener pairCreatedAt (unix ms). Lets the server find an unknown V4 pool's Initialize log. */
  createdAt?: number;
  /** DexScreener liquidity.usd. Only ranks which paths we quote; simulation decides the fill. */
  liquidityUsd?: number;
  /** DexScreener priceChange m5 and h1, in percent. Set Auto slippage for the requester's own trade only. */
  priceChangeM5Pct?: number;
  priceChangeH1Pct?: number;
}

export const MAX_SWAP_POOL_HINTS = 24;

export function parseSwapPoolHints(value: unknown): SwapPoolHint[] | null {
  throw new NotImplementedInPublicBuild("lib/swap/pool-hints.ts#parseSwapPoolHints");
}