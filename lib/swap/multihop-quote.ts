// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { ChainReader } from "../rpc/client";

import type { PublicClient } from "viem";

import { resolveQuoteRoute } from "../dex/registry";

import { quoteV3ExactInputSingle } from "../dex/v3-quoter";

import { batchRead, type BatchCall, type BatchResult } from "../rpc/multicall";

import { quoterV2Abi, v2Router02Abi } from "../rpc/abis";

import type { PoolRef } from "../dex/types";

import type { MultihopCandidatePools } from "./multihop-discovery";

import type { UniversalRouterProfile } from "./venues";

import { NATIVE, type Address, type SwapFamily } from "./types";

import { WETH } from "./venues";

import { swapClient } from "./read-client";

export interface PricedHop {
  pool: PoolRef;
  amountIn: bigint;
  amountOut: bigint;
  feeTier?: number;
}

export interface PricedMultihopCandidate {
  family: SwapFamily;
  protocol: "v2" | "v3";
  profile: UniversalRouterProfile;
  bridge: Address;
  leg1: PricedHop;
  leg2: PricedHop;
  amountIn: bigint;
  amountOut: bigint;
  leg1Protocol?: "v2" | "v3";
  leg2Protocol?: "v2" | "v3";
}

export interface MultihopQuoteResult {
  quotes: PricedMultihopCandidate[];
  complete: boolean;
}

export interface MultihopQuoteDeps {
  client?: ChainReader;
  batchRead?: typeof batchRead;
  quoteHop?: (
    pool: PoolRef,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    client: ChainReader,
  ) => Promise<bigint>;
}

export async function quoteSingleHop(pool: PoolRef, tokenIn: Address, tokenOut: Address, amountIn: bigint, client: ChainReader): Promise<bigint> {
  throw new NotImplementedInPublicBuild("lib/swap/multihop-quote.ts#quoteSingleHop");
}

export async function quoteMultihopRoutes(candidates: MultihopCandidatePools[], tokenIn: Address, tokenOut: Address, amountIn: bigint, deps: MultihopQuoteDeps = undefined as any): Promise<MultihopQuoteResult> {
  throw new NotImplementedInPublicBuild("lib/swap/multihop-quote.ts#quoteMultihopRoutes");
}