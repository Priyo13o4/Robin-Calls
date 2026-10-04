// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { decodeErrorResult, decodeFunctionResult, encodeFunctionData } from "viem";

import { rpc, type ChainReader } from "../rpc/client";

import { addresses, isAddressConfigured } from "../config/chain";

import { isTransientRpcError } from "../rpc/fault";

import { erc20Abi, v4QuoterAbi, v4StateViewAbi, V4_HOOK_FLAGS, V4_HOOK_HONEYPOT_SELECTORS } from "../rpc/abis";

import type { PoolRef, SellSim } from "./types";

export type QuoteResult =
  | { kind: "OUT"; amountOut: string }
  | { kind: "ZERO" }
  | { kind: "REVERT"; detail: string }
  | { kind: "NOT_RUN"; reason: string }
  /**
   * The quote never reached the node. NOT a revert — CLAUDE.md §4's headline
   * case: viem throws identically for "the contract reverted" and "the node
   * never replied", and this adapter collapsed both into REVERT. A timeout on
   * the sell leg with a working buy leg therefore published **CRITICAL
   * "buy-only trap"** about a pool whose sell was never actually quoted.
   *
   * Its V2 and V3 twins have discriminated faults from the start; this one
   * never did (§8 #8 — add the flag to every sibling, then check something
   * READS it).
   */
  | { kind: "FAULT"; detail: string };

export type PoolTradeability = "live" | "dead" | "unknown";

export function tradeabilityOf(activeLiquidity: bigint | null, hooks: `0x${string}`): PoolTradeability {
  throw new NotImplementedInPublicBuild("lib/dex/v4-sim.ts#tradeabilityOf");
}

interface HookFlags {
  beforeSwap: boolean;
  afterSwap: boolean;
  beforeSwapReturnsDelta: boolean;
  afterSwapReturnsDelta: boolean;
  swapAffecting: boolean;
}

export function hookFlags(hooks: `0x${string}`): HookFlags {
  throw new NotImplementedInPublicBuild("lib/dex/v4-sim.ts#hookFlags");
}

export const V4_ROUND_TRIP_MIN_FRACTION = 0.5;

export function v4CounterProbeAmount(decimals: number): bigint | null {
  throw new NotImplementedInPublicBuild("lib/dex/v4-sim.ts#v4CounterProbeAmount");
}

export async function quote(key: NonNullable<PoolRef["v4Key"]>, zeroForOne: boolean, exactAmount: bigint, client: ChainReader = undefined as any): Promise<QuoteResult> {
  throw new NotImplementedInPublicBuild("lib/dex/v4-sim.ts#quote");
}

export function extractV4RevertDetail(e: unknown): string {
  throw new NotImplementedInPublicBuild("lib/dex/v4-sim.ts#extractV4RevertDetail");
}

export async function runV4SellSim(token: `0x${string}`, pool: PoolRef): Promise<SellSim> {
  throw new NotImplementedInPublicBuild("lib/dex/v4-sim.ts#runV4SellSim");
}

export function classifyV4Sell(sell: QuoteResult, buy: QuoteResult, hooks: `0x${string}`, extra: Record<string, unknown> = undefined as any, tradeable: PoolTradeability = undefined as any): SellSim {
  throw new NotImplementedInPublicBuild("lib/dex/v4-sim.ts#classifyV4Sell");
}