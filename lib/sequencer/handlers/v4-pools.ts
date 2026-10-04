// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import {
  encodeAbiParameters,
  keccak256,
  parseAbi,
  parseAbiParameters,
  decodeFunctionData,
  type Hex,
  type Address,
} from "viem";

import type { SequencerTransaction } from "../types";

import type { V4PoolDraft } from "@/lib/launches/types";

import { addresses, isAddressConfigured } from "@/lib/config/chain";

export const V4_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951" as const;

export const DEFAULT_V4_POOL_MANAGER = V4_POOL_MANAGER;

export const V4_POSITION_MANAGER = "0x58daec3116aae6d93017baaea7749052e8a04fa7" as const;

export const UNIVERSAL_ROUTER = "0x8876789976decbfcbbbe364623c63652db8c0904" as const;

export const V4_INIT_SELECTOR_HOOK = "0x695c5bf5";

export const V4_INIT_SELECTOR_NO_HOOK = "0x6276cbbe";

export const POSM_INIT_SELECTOR_HOOK = "0x3b1fda97";

export const POSM_INIT_SELECTOR_NO_HOOK = "0xf7020405";

export const UR_EXECUTE_SELECTOR = "0x3593564c";

export const V4_INIT_WITH_HOOK_ABI = {} as any;

export const V4_INITIALIZE_ABI = V4_INIT_WITH_HOOK_ABI;

export interface RawPoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

export interface TradeTickerItem {
  tokenAddress: string;
  txHash: string;
  blockNumber: number;
  timestamp: number;
  side: "BUY" | "SELL";
  amount: string;
  quoteAmount?: string;
  sender?: string;
  poolId?: string;
}

export function isCanonicalV4PoolManager(target: string | null | undefined): boolean {
  throw new NotImplementedInPublicBuild("lib/sequencer/handlers/v4-pools.ts#isCanonicalV4PoolManager");
}

export function isCanonicalV4PositionManager(target: string | null | undefined): boolean {
  throw new NotImplementedInPublicBuild("lib/sequencer/handlers/v4-pools.ts#isCanonicalV4PositionManager");
}

export function isValidV4PoolKey(key: {
  currency0?: string | null;
  currency1?: string | null;
  fee?: number | null;
  tickSpacing?: number | null;
  hooks?: string | null;
}): boolean {
  throw new NotImplementedInPublicBuild("lib/sequencer/handlers/v4-pools.ts#isValidV4PoolKey");
}

export function computeV4PoolId(currency0OrKey: string | { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string }, currency1?: string, fee?: number, tickSpacing?: number, hooks?: string): Hex {
  throw new NotImplementedInPublicBuild("lib/sequencer/handlers/v4-pools.ts#computeV4PoolId");
}

export function extractV4PoolKey(to: string | null, data: string): RawPoolKey | null {
  throw new NotImplementedInPublicBuild("lib/sequencer/handlers/v4-pools.ts#extractV4PoolKey");
}

export function handleV4PoolTransaction(tx: SequencerTransaction | { hash?: string; to: string | null; data: string }, blockNumber: number = undefined as any): V4PoolDraft | null {
  throw new NotImplementedInPublicBuild("lib/sequencer/handlers/v4-pools.ts#handleV4PoolTransaction");
}

export function evaluateV4PoolTransaction(tx: SequencerTransaction, blockNumber?: number, _poolManagerAddress?: string): V4PoolDraft | null {
  throw new NotImplementedInPublicBuild("lib/sequencer/handlers/v4-pools.ts#evaluateV4PoolTransaction");
}

export function evaluateV4TradeTransaction(_tx: SequencerTransaction, _blockNumber?: number, _timestamp?: number): TradeTickerItem | null {
  throw new NotImplementedInPublicBuild("lib/sequencer/handlers/v4-pools.ts#evaluateV4TradeTransaction");
}