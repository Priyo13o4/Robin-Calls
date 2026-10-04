// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { decodeEventLog, parseAbiItem, toEventSelector, type Abi, type AbiEvent, type Hex } from "viem";

import {
  commitPoolLiquidityHistoryWindow,
  readLiquidityHistoryPoolFloor,
  PoolLiquidityHistoryCursorMovedError,
  readPoolLiquidityHistoryCursor,
  readPoolLiquidityHistoryEvents,
  resetPoolLiquidityHistory,
  type LiquidityHistoryEvent,
  type LiquidityHistoryEventName,
  type LiquidityHistoryProtocol,
  type CursorRead,
  appendLiquidityHistoryStep,
} from "../data/pool-liquidity-history";

import { addresses } from "../config/chain";

import { currentScanContext } from "../observability/context";

import { v3BurnEvent, v3MintEvent, v4ModifyLiquidityEvent } from "../rpc/abis";

import { adaptiveLogWalk, publicRpcClientWithTimeout, type AdaptiveWalkResult } from "../rpc/adaptive-walk";

import { walkLogRange } from "../rpc/range-walk";

import { V2_BURN, V2_MINT, V3_BURN, V3_COLLECT, V3_MINT, V4_MODIFY, type RawLpLog } from "../trade/lp-events";

export const POOL_LIQUIDITY_HISTORY = {
  /** Tails longer than this take the per-pool walk (history) or restart empty (NFT owners): one address-list getLogs stays small. */
  batchTailMaxBlocks: 50_000,
  confirmations: 5,
  targetLogs: 2_000,
  minWindow: 1_000,
  maxWindow: 10_000_000,
  initialWindow: 2_000_000,
  jobBudgetMs: 20_000,
  scanTailBudgetMs: 15_000,
  flightsMax: 32,
} as const;

export interface LiquidityHistoryPool {
  protocol: LiquidityHistoryProtocol;
  /** Pool contract address for V2/V3, poolId for V4. */
  pool: string;
  fromBlock: number;
}

export interface LiquidityHistoryCoverage {
  status: "complete" | "partial" | "missing" | "faulted";
  indexedToBlock: number | null;
  safeHead: number | null;
  budgetExhausted?: boolean;
  reason?: string;
}

export interface LiquidityHistoryPoolCoverage {
  pool: LiquidityHistoryPool;
  coverage: LiquidityHistoryCoverage;
}

export class LiquidityHistoryBudgetExhaustedError extends Error {
  constructor() {
    super("liquidity history request budget exhausted");
    this.name = "LiquidityHistoryBudgetExhaustedError";
  }
}

type RawLog = {
  data: Hex;
  topics: readonly Hex[];
  blockNumber?: bigint | null;
  transactionHash?: Hex | null;
  logIndex?: number | null;
};

export function mapLiquidityHistoryLogs(protocol: LiquidityHistoryProtocol, pool: string, logs: readonly RawLog[]): LiquidityHistoryEvent[] {
  throw new NotImplementedInPublicBuild("lib/dex/pool-liquidity-history.ts#mapLiquidityHistoryLogs");
}

export interface PoolHistoryDeps {
  readCursor(protocol: LiquidityHistoryProtocol, pool: string): ReturnType<typeof readPoolLiquidityHistoryCursor>;
  readEvents(protocol: LiquidityHistoryProtocol, pool: string, from: number, to: number): ReturnType<typeof readPoolLiquidityHistoryEvents>;
  commit(input: Parameters<typeof commitPoolLiquidityHistoryWindow>[0]): Promise<void>;
  reset(protocol: LiquidityHistoryProtocol, pool: string, expected: Extract<CursorRead, { status: "ok" }>): Promise<boolean>;
  head(): Promise<number>;
  blockHash(block: number): Promise<string>;
  getLogs(protocol: LiquidityHistoryProtocol, pool: string, from: number, to: number): Promise<LiquidityHistoryEvent[]>;
  now(): number;
}

type ScanHistoryPoolSnapshot = {
  fromBlock: number;
  cursor: Extract<CursorRead, { status: "ok" }>;
  endpointVerified: boolean;
  coverage: LiquidityHistoryCoverage;
  rows?: LiquidityHistoryEvent[];
};

type ScanHistorySnapshot = { safeHead: number; pools: Map<string, ScanHistoryPoolSnapshot> };

export async function beginLiquidityHistorySnapshot(budgetMs: number = undefined as any, overrides: Partial<PoolHistoryDeps> = undefined as any): Promise<number | null> {
  throw new NotImplementedInPublicBuild("lib/dex/pool-liquidity-history.ts#beginLiquidityHistorySnapshot");
}

export async function fetchPoolLiquidityHistoryLogs(protocol: LiquidityHistoryProtocol, pool: string, from: number, to: number, getClient: () => ReturnType<typeof publicRpcClientWithTimeout> = undefined as any): Promise<LiquidityHistoryEvent[]> {
  throw new NotImplementedInPublicBuild("lib/dex/pool-liquidity-history.ts#fetchPoolLiquidityHistoryLogs");
}

export async function readIndexedPoolLiquidityHistory(pool: LiquidityHistoryPool, opts: { deps?: Partial<PoolHistoryDeps>; tailBudgetMs?: number; verifiedSnapshotOnly?: boolean } = undefined as any): Promise<{ coverage: LiquidityHistoryCoverage; rows: LiquidityHistoryEvent[] }> {
  throw new NotImplementedInPublicBuild("lib/dex/pool-liquidity-history.ts#readIndexedPoolLiquidityHistory");
}

export async function readLiquidityHistoryCoverage(pools: readonly LiquidityHistoryPool[], opts: { deps?: Partial<PoolHistoryDeps>; budgetMs?: number } = undefined as any): Promise<{ safeHead: number | null; pools: LiquidityHistoryPoolCoverage[] }> {
  throw new NotImplementedInPublicBuild("lib/dex/pool-liquidity-history.ts#readLiquidityHistoryCoverage");
}

export async function advancePoolLiquidityHistory(pool: LiquidityHistoryPool, opts: { deps?: Partial<PoolHistoryDeps>; budgetMs?: number } = undefined as any): Promise<LiquidityHistoryCoverage> {
  throw new NotImplementedInPublicBuild("lib/dex/pool-liquidity-history.ts#advancePoolLiquidityHistory");
}

export interface V4ModifyRow {
  sender: string;
  tickLower: number;
  tickUpper: number;
  /** bigint as string. */
  liquidityDelta: string;
  salt: string;
  txHash: string;
  block: number;
  logIndex: number;
}

export interface V3PositionEvent {
  owner: string;
  tickLower: number;
  tickUpper: number;
  /** Liquidity units, bigint as string. */
  amount: string;
  amount0: string;
  amount1: string;
  txHash: string;
  block: number;
  logIndex: number;
}

export function v4ModifyRows(rows: readonly LiquidityHistoryEvent[]): V4ModifyRow[] {
  throw new NotImplementedInPublicBuild("lib/dex/pool-liquidity-history.ts#v4ModifyRows");
}

export function v3PositionEvents(rows: readonly LiquidityHistoryEvent[], name: "Mint" | "Burn"): V3PositionEvent[] {
  throw new NotImplementedInPublicBuild("lib/dex/pool-liquidity-history.ts#v3PositionEvents");
}

export async function readCompletePoolHistory(protocol: LiquidityHistoryProtocol, pool: string, opts: { verifiedSnapshotOnly?: boolean; budgetMs?: number } = undefined as any): Promise<{ rows: LiquidityHistoryEvent[]; ceiling: bigint } | null> {
  throw new NotImplementedInPublicBuild("lib/dex/pool-liquidity-history.ts#readCompletePoolHistory");
}

export function groupStepLogs(logs: readonly RawLpLog[]): Map<string, RawLpLog[]> {
  throw new NotImplementedInPublicBuild("lib/dex/pool-liquidity-history.ts#groupStepLogs");
}

export function historyEventsFor(logs: readonly RawLpLog[], protocol: LiquidityHistoryProtocol, pool: string, afterBlock: number): LiquidityHistoryEvent[] {
  throw new NotImplementedInPublicBuild("lib/dex/pool-liquidity-history.ts#historyEventsFor");
}

export async function syncLiquidityHistoryTails(pools: readonly LiquidityHistoryPool[], opts: { budgetMs?: number; deps?: Partial<PoolHistoryDeps>; fetchLogs?: (filter: { address: string[]; topics: (string | string[] | null)[] }, from: number, to: number) => Promise<RawLpLog[]>; append?: typeof appendLiquidityHistoryStep } = undefined as any): Promise<{ advanced: number; skipped: number }> {
  throw new NotImplementedInPublicBuild("lib/dex/pool-liquidity-history.ts#syncLiquidityHistoryTails");
}