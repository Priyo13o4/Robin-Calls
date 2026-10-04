// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { rpc } from "../rpc/client";

import {
  v3PoolStateAbi,
  clPoolStateAbi,
  v4StateViewAbi,
} from "../rpc/abis";

import { blockTimestamps } from "../rpc/block-time";

import { addresses, isAddressConfigured } from "../config/chain";

import { batchRead, type BatchCall } from "../rpc/multicall";

import { pullPoolsFrom, readDeployerSidePulls } from "./deployer-pulls";

import { mapWithConcurrency } from "../rpc/fanout";

import { scanTimeLeftMs } from "../rpc/provider-pool";

import { reservesLensCall, reservesFromResult, type V4Reserves } from "./v4-reserves";

import type { PoolRef } from "./types";

import { valuePoolFlow, type PositionEvent, type ValuedFlow } from "./pool-value";

import { readCompletePoolHistory, v3PositionEvents, v4ModifyRows, type V4ModifyRow } from "./pool-liquidity-history";

export type PullProtocol = "uniswap-v2" | "uniswap-v3" | "slipstream-cl" | "uniswap-v4";

export interface AttributedPull {
  protocol: PullProtocol;
  /** The pool the liquidity left — the pair/pool address, or the V4 poolId. */
  pool: string;
  txHash: string;
  block: number;
  /** Distinguishes multiple removals inside one transaction. */
  logIndex?: number;
  /** Human tag for the removal mechanism. */
  method: string;
  /**
   * L61 item 4 — a position taken to zero is a completed exit; a decrease is
   * not, and must not borrow the full-pull wording. `unknown` when the index
   * that would net it was itself incomplete: never guess this as "complete",
   * because "complete" is the harsher accusation.
   */
  exit?: "complete" | "partial" | "unknown";
  /** The subject address the removal is attributed to (the creator or the launch-tx sender). */
  by?: string;
}

export interface LiquidityPullEvidence {
  /**
   * OK      — every leg with something to index answered; `attributed` is the
   *           real, complete result.
   * PARTIAL — at least one leg answered and at least one did not. The found
   *           pulls are real; the ABSENCE of one is not a fact, so a caller may
   *           fire on `attributed` but must never publish an all-clear.
   * SKIP    — there was nothing to index at all (no pool on any covered venue).
   * UNAVAILABLE — there WAS something to index and every read faulted. Distinct
   *           from SKIP because it must never be read as "no pull found" (§7.1).
   */
  status: "OK" | "PARTIAL" | "SKIP" | "UNAVAILABLE";
  /** Removals on this token's own pools attributable to the deployer. */
  attributed: AttributedPull[];
  scanned: {
    v2Pairs: number;
    v3Pools: number;
    v4Pools: number;
    windowBlocks: string;
    /** `protocol:pool` legs that answered end to end. */
    venuesCovered: string[];
    /**
     * Legs that existed and could NOT be read. §8 #8: a fault flag is only real
     * if something reads it — `checkDeployerPulledLiquidity` SKIPs on a
     * non-empty list rather than publishing an all-clear over it.
     */
    venuesUnread: string[];
  };
  note?: string;
  /**
   * What happened to these pools regardless of who did it (L109). Absent only
   * when there was nothing to index at all.
   */
  poolFlow?: PoolLiquidityFlow;
  /** D4: removals by the deployer below the dust share of supply; counted, never accusing. */
  deployerDustPulls?: number;
  /** L212: each V4 pool's reserves read from the PoolManager, by lowercased poolId. Null = not measured. */
  v4Reserves?: Record<string, V4Reserves | null>;
}

export interface RemovalCandidate {
  protocol: PullProtocol;
  pool: string;
  /** The address the pool saw as the actor — periphery, or the wallet itself. */
  sender: string;
  txHash: string;
  block: number;
  logIndex: number;
  exit: "complete" | "partial" | "unknown";
  method: string;
  /**
   * Liquidity units removed, as a STRING — bigint does not survive JSONB, and
   * this shape is stored. Absent when the leg could not report an amount.
   */
  liquidity?: string;
  tickLower?: number;
  tickUpper?: number;
  positionKey?: string;
  /** False when the protocol event has no LP-owner field (V2 pair Burn). */
  attributionKnown?: boolean;
  /** V2 Burn reports underlying token amounts, not liquidity units. */
  amount0Removed?: string;
  amount1Removed?: string;
  tokenAmountRemoved?: string;
  quoteAmountRemoved?: string;
}

export interface AdditionRow {
  pool: string;
  block: number;
  logIndex: number;
  txHash: string;
  /** Liquidity units added, string for the same reason as above. */
  liquidity: string;
  tickLower?: number;
  tickUpper?: number;
  positionKey?: string;
}

export type V4ModRow = V4ModifyRow;

export function classifyV4Removals(rows: readonly V4ModRow[], poolId: string, complete: boolean): RemovalCandidate[] {
  throw new NotImplementedInPublicBuild("lib/dex/liquidity-pulls.ts#classifyV4Removals");
}

export interface PoolLiquidityFlow {
  /**
   * OK — every discovered pool's add AND remove streams answered.
   * PARTIAL — at least one leg did not, so the absence of a withdrawal here is
   *   not a fact and this must never be read as "nothing left this pool".
   * UNAVAILABLE — nothing was read at all.
   */
  status: "OK" | "PARTIAL" | "UNAVAILABLE";
  /** Liquidity units, over all history on the legs that answered. */
  addedAll: string;
  removedAll: string;
  /** …restricted to blocks at or after `windowFromBlock`. */
  addedRecent: string;
  removedRecent: string;
  /** Null when the head block could not be read — then `recent` is all history. */
  windowFromBlock: number | null;
  windowHours: number;
  /** Most recent removal on any leg, and its age. Null when there is none. */
  lastRemovalBlock: number | null;
  lastRemovalAgeHours: number | null;
  removals: number;
  /** Removals NOT attributable to the deployer — the population nothing scored. */
  removalsByOthers: number;
  /** V2 Burn events expose underlying amounts but do not identify the LP owner. */
  unattributedV2Burns?: Record<string, { count: number; amount0: string; amount1: string; tokenAmount: string; quoteAmount: string }>;
  /** Legs whose add or remove stream we could not read. Never empty on PARTIAL. */
  unread: string[];
  /**
   * The same totals per pool, keyed by lowercased pool (the poolId on V4). The
   * token-wide sums above mix strangers' pools into the one a sentence names (L137).
   */
  byPool?: Record<string, PoolFlowTotals>;
  valued?: ValuedFlow;
}

export interface PoolFlowTotals {
  addedAll: string;
  removedAll: string;
  addedRecent: string;
  removedRecent: string;
  lastRemovalBlock: number | null;
  valued?: ValuedFlow;
}

export const POOL_FLOW_WINDOW_HOURS = 24;

export async function resolveWindowFromBlock(hours: number): Promise<number | null> {
  throw new NotImplementedInPublicBuild("lib/dex/liquidity-pulls.ts#resolveWindowFromBlock");
}

export function summarisePoolFlow(input: {
  removals: readonly RemovalCandidate[];
  additions: readonly AdditionRow[];
  attributedKeys: ReadonlySet<string>;
  windowFromBlock: number | null;
  lastRemovalAgeHours: number | null;
  unread: readonly string[];
  legsRead: number;
  currentTicks?: Readonly<Record<string, number | null>>;
}): PoolLiquidityFlow {
  throw new NotImplementedInPublicBuild("lib/dex/liquidity-pulls.ts#summarisePoolFlow");
}

export function pullIndexStatus(covered: readonly string[], unread: readonly string[]): "UNAVAILABLE" | "PARTIAL" | "OK" {
  throw new NotImplementedInPublicBuild("lib/dex/liquidity-pulls.ts#pullIndexStatus");
}

export const FLOW_DEADLINE_RESERVE_MS = 30_000;

export async function indexDeployerLiquidityPulls(token: `0x${string}`, poolRefs: readonly PoolRef[] | undefined, deployer: `0x${string}` | null, launchSender: string | null = undefined as any, opts: {
    /** D2: pools that get pool-wide history reads; the rest are counted by the caller. */
    flowPools?: readonly PoolRef[];
    /** Pulls under DUST_PULL_SUPPLY_BPS of this do not accuse. */
    totalSupply?: bigint | null;
    /** Lens reserves the caller already read, so they are not read twice. */
    v4Reserves?: Record<string, V4Reserves | null>;
    /** A contract never signs a transaction, so its sent history is empty by construction, not clean. */
    deployerIsContract?: boolean;
    /** Test seam for the scan's remaining deadline. */
    timeLeftMs?: () => number | null;
  } = undefined as any): Promise<LiquidityPullEvidence> {
  throw new NotImplementedInPublicBuild("lib/dex/liquidity-pulls.ts#indexDeployerLiquidityPulls");
}