// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { decodeAbiParameters, toEventSelector, type Hex } from "viem";

import type { swapPools } from "../db/schema";

export const V4_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";

export const V2_MINT = toEventSelector("Mint(address,uint256,uint256)");

export const V2_BURN = {} as any;

export const V3_MINT = {} as any;

export const V3_BURN = {} as any;

export const V3_COLLECT = {} as any;

export const V4_MODIFY = {} as any;

export const V3_INITIALIZE = toEventSelector("Initialize(uint160,int24)");

export const V4_INITIALIZE = {} as any;

export const V2_PAIR_CREATED = {} as any;

export const V3_POOL_CREATED = {} as any;

export const SLIPSTREAM_POOL_CREATED = {} as any;

export const NPM_INCREASE_LIQUIDITY = {} as any;

export const NPM_DECREASE_LIQUIDITY = {} as any;

export const LP_TOPICS = [
  V2_MINT, V2_BURN, V3_MINT, V3_BURN, V4_MODIFY, V3_INITIALIZE, V4_INITIALIZE,
  V2_PAIR_CREATED, V3_POOL_CREATED, SLIPSTREAM_POOL_CREATED,
  NPM_INCREASE_LIQUIDITY, NPM_DECREASE_LIQUIDITY,
] as const;

export interface RegisteredFactory {
  dex: string;
  protocol: "v2" | "v3";
  /** V2 pairs carry no fee field: Pancake V2 charges 0.25%, measured via its Router02 getAmountsOut. */
  v2Fee?: number;
}

export const POOL_FACTORIES: Record<string, RegisteredFactory> = {} as any;

export function decodePoolCreation(log: RawLpLog): typeof swapPools.$inferInsert | null {
  throw new NotImplementedInPublicBuild("lib/trade/lp-events.ts#decodePoolCreation");
}

export interface RawLpLog { address: string; topics: readonly Hex[]; data: Hex; blockNumber: Hex | string; transactionHash: Hex | string; logIndex?: Hex | string | null; blockTimestamp?: Hex | string | null }

export interface LpEvent {
  pool: string;
  protocol: "v2" | "v3" | "v4";
  kind: "add" | "remove";
  /** Position liquidity moved (V3/V4). Null for V2, whose events carry no LP-token amount. */
  liquidity: bigint | null;
  /** Token amounts (currency0/1). Null for V4: its event carries only liquidity. */
  a0: bigint | null;
  a1: bigint | null;
  tickLower: number | null;
  tickUpper: number | null;
  block: number;
  /** Unix seconds only when supplied by a source; Robinhood's public node sends 0x0. */
  at: number | null;
  tx: string;
  index: number;
}

export interface PoolBirth { pool: string; protocol: "v3" | "v4"; born: number }

export function decodeLpLog(log: RawLpLog): LpEvent | PoolBirth | null {
  throw new NotImplementedInPublicBuild("lib/trade/lp-events.ts#decodeLpLog");
}

export const isBirth = (e: LpEvent | PoolBirth): e is PoolBirth => {
  throw new NotImplementedInPublicBuild("lib/trade/lp-events.ts#isBirth");
};

export type WireLpEvent = Omit<LpEvent, "liquidity" | "a0" | "a1"> & { liquidity: string | null; a0: string | null; a1: string | null };

export const toWire = (e: LpEvent): WireLpEvent => {
  throw new NotImplementedInPublicBuild("lib/trade/lp-events.ts#toWire");
};

export const fromWire = (e: WireLpEvent): LpEvent => {
  throw new NotImplementedInPublicBuild("lib/trade/lp-events.ts#fromWire");
};

export type StoredLpEvent = Omit<WireLpEvent, "pool" | "protocol">;

export const fromStored = (e: StoredLpEvent, pool: string, protocol: LpEvent["protocol"]): LpEvent => {
  throw new NotImplementedInPublicBuild("lib/trade/lp-events.ts#fromStored");
};

export interface PoolLpRecord {
  protocol: "v2" | "v3" | "v4";
  epoch: number;
  born: number | null;
  /** Sum of position liquidity added minus removed. Null: V2, or the sum went negative (we missed an add). */
  net: string | null;
  peak: string | null;
  peakBlock: number | null;
  adds: number;
  removes: number;
  firstAdd: StoredLpEvent | null;
  lastRemove: StoredLpEvent | null;
  /** Block where a removal took `net` to zero on a pool we saw born. */
  emptiedAt: number | null;
  /** Newest last, capped. */
  events: StoredLpEvent[];
  through: number;
}

export const RECORD_EVENTS = 10;

export function foldPool(prev: PoolLpRecord | null, epoch: number, items: readonly (LpEvent | PoolBirth)[]): PoolLpRecord | null {
  throw new NotImplementedInPublicBuild("lib/trade/lp-events.ts#foldPool");
}

export function recordAnswersLookback(rec: PoolLpRecord | null): boolean {
  throw new NotImplementedInPublicBuild("lib/trade/lp-events.ts#recordAnswersLookback");
}