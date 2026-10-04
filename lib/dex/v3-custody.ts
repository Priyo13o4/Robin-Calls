// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { keccak256, encodePacked, parseEventLogs, type Abi } from "viem";

import { rpc } from "../rpc/client";

import { batchRead } from "../rpc/multicall";

import { readCompletePoolHistory, v3PositionEvents } from "./pool-liquidity-history";

import { resolveNftOwners } from "./position-nft-owners";

import { mapWithConcurrency } from "../rpc/fanout";

import { addresses, isAddressConfigured } from "../config/chain";

import {
  clPoolStateAbi,
  npmAbi,
  npmIncreaseLiquidityEvent,
  v3PoolInitializeEvent,
  v3PoolStateAbi,
} from "../rpc/abis";

import {
  coverageMinPct,
  classifyOwner,
  decideCustodyState,
  exemptOwners,
  floorPct,
  foldStakes,
  largestNonExempt,
  protectedPct,
  pullableDeployerStake,
  shareOf,
  sumFor,
  trustedLockers,
  lockersMatched,
  type OwnerKind,
  type OwnerStake,
} from "./custody";

import { custodyThresholds } from "../config/custody-thresholds";

import { DEAD_ADDRESSES } from "../config/chain";

import { readMatchedLockState } from "./lock-terms";

import { classifyLaunchShape, maxUsableTick, tickSpacingForFeeTier, type LaunchShapeRecognition } from "./launch-shape";

import { flags } from "../config/flags";

import type { LpCustody, OwnerLookThrough, PoolRef } from "./types";

interface MintLog {
  owner: `0x${string}`;
  tickLower: number;
  tickUpper: number;
  txHash: `0x${string}`;
  /** Raw Mint amounts, pool-native token0/token1 order, for A5. Strings as stored; `BigInt(...)` only at use. */
  amount0: string;
  amount1: string;
}

export async function indexPoolMints(pool: `0x${string}`, opts: { protocol?: "uniswap-v3" | "slipstream-cl"; budgetMs?: number } = undefined as any): Promise<{ mints: MintLog[]; complete: boolean; ceiling: bigint } | null> {
  throw new NotImplementedInPublicBuild("lib/dex/v3-custody.ts#indexPoolMints");
}

export function orderMintTxsByRangeSize(mints: readonly { owner: `0x${string}`; tickLower: number; tickUpper: number; txHash: `0x${string}` }[], npm: string, rangeLiquidity: ReadonlyMap<string, bigint>): `0x${string}`[] {
  throw new NotImplementedInPublicBuild("lib/dex/v3-custody.ts#orderMintTxsByRangeSize");
}

export async function readV3LpCustody(token: `0x${string}`, pool: PoolRef, deployer: string | null, opts: { lookThrough?: OwnerLookThrough } = undefined as any): Promise<LpCustody> {
  throw new NotImplementedInPublicBuild("lib/dex/v3-custody.ts#readV3LpCustody");
}