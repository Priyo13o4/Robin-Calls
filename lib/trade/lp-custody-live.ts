// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



const BUCKET_KEYS = LP_CUSTODY_BUCKETS;

import type { Abi } from "viem";

import { getPoolIdentity, readPositionSnapshot, bumpPositionVisit } from "@/lib/data/lp-positions";

import { readTokenV2V3Pools } from "@/lib/data/swap-pools";

import { readV4PoolKey } from "@/lib/data/v4-pools";

import { flags } from "@/lib/config/flags";

import { addresses, DEAD_ADDRESSES } from "@/lib/config/chain";

import { primeTrustedLockers, trustedLockerMap } from "@/lib/config/lockers";

import { primeLockerAdapters } from "@/lib/config/locker-adapters";

import { clFactories } from "@/lib/config/dex-registry";

import { classifyOwner, lockersMatched } from "@/lib/dex/custody";

import { gaugeLookThrough } from "@/lib/dex/slipstream";

import { hookBlocksRemoval } from "@/lib/dex/hook-removal-lock";

import { dopplerStatusLocksCurve, readDopplerLock } from "@/lib/dex/doppler-lock";

import { lockStillProtects, readMatchedLockState } from "@/lib/dex/lock-terms";

import { PONS_LAUNCH_LOCKERS, readPonsLock } from "@/lib/dex/pons-lock";

import { reservesFromResult, type V4PoolKey } from "@/lib/dex/v4-reserves";

import { isWalletKind } from "@/lib/scanner/entity";

import { v3PoolStateAbi, clPoolStateAbi, v4StateViewAbi, erc20Abi, v4ReservesLensAbi } from "@/lib/rpc/abis";

import { rpc } from "@/lib/rpc/client";

import { batchRead } from "@/lib/rpc/multicall";

import { resolveNftOwners } from "@/lib/dex/position-nft-owners";

import { explorer } from "@/lib/explorer/blockscout";

import { LP_CUSTODY_BUCKETS, type LpCustodyBuckets, type LpCustodyLiveResult } from "./lp-custody-shared";

export const MAX_POSITION_LAG_BLOCKS = 3_000;

type BucketKey = typeof BUCKET_KEYS[number];

type Buckets = LpCustodyBuckets;

export type { LpCustodyLiveResult };

type Position = Awaited<ReturnType<typeof readPositionSnapshot>>["positions"][number];

export function positionsAreCurrent(storedBlock: number, head: number): boolean {
  throw new NotImplementedInPublicBuild("lib/trade/lp-custody-live.ts#positionsAreCurrent");
}

export function reconcileActiveLiquidity(positions: readonly Pick<Position, "tickLower" | "tickUpper" | "liquidity">[], tick: number, active: bigint): boolean {
  throw new NotImplementedInPublicBuild("lib/trade/lp-custody-live.ts#reconcileActiveLiquidity");
}

export function poolSharePct(thisPool: bigint, total: bigint): number | null {
  throw new NotImplementedInPublicBuild("lib/trade/lp-custody-live.ts#poolSharePct");
}

export function appendPoolShareClause(summary: string, poolSharePct: number | null): string {
  throw new NotImplementedInPublicBuild("lib/trade/lp-custody-live.ts#appendPoolShareClause");
}

export function _resetShareCacheForTests(): void {
  throw new NotImplementedInPublicBuild("lib/trade/lp-custody-live.ts#_resetShareCacheForTests");
}

export interface PoolShareDeps {
  readPools?: (token: string) => Promise<{ pools: string[]; overflow: boolean } | null>;
  batchRead?: typeof batchRead;
  now?: () => number;
}

export function readPoolShare(token: string, pool: string, protocol: "v2" | "v3" | "v4", v4Key: V4PoolKey | null, deps?: PoolShareDeps): Promise<number | null> {
  throw new NotImplementedInPublicBuild("lib/trade/lp-custody-live.ts#readPoolShare");
}

export function summaryFor(buckets: Buckets, largestWalletPct: number, ponsPct: number, dopplerPct: any = undefined as any, timelockDate: number | null = undefined as any, timelockTermsUnreadable: any = undefined as any): string {
  throw new NotImplementedInPublicBuild("lib/trade/lp-custody-live.ts#summaryFor");
}

export async function getLiveLpCustody({ poolId, token }: { poolId: string; token: string }): Promise<LpCustodyLiveResult> {
  throw new NotImplementedInPublicBuild("lib/trade/lp-custody-live.ts#getLiveLpCustody");
}