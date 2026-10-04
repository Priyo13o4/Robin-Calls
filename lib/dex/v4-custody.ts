// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { Abi } from "viem";

import { rpc } from "../rpc/client";

import { batchRead, isFaulted } from "../rpc/multicall";

import { addresses, isAddressConfigured, DEAD_ADDRESSES } from "../config/chain";

import { launchpadIdentity } from "../config/trusted-addresses";

import { ownableAbi, v4StateViewAbi } from "../rpc/abis";

import { isVenueInfrastructure } from "./custody";

import { readCompletePoolHistory, v4ModifyRows, type V4ModifyRow } from "./pool-liquidity-history";

import { resolveNftOwners } from "./position-nft-owners";

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

import { readMatchedLockState } from "./lock-terms";

import { dopplerStatusLocksCurve, readDopplerLock } from "./doppler-lock";

import { readPonsLock, type PonsLockRead } from "./pons-lock";

import { hookBlocksRemoval } from "./hook-removal-lock";

import type { LpCustody, PoolRef } from "./types";

interface V4Position {
  sender: `0x${string}`;
  tickLower: number;
  tickUpper: number;
  salt: `0x${string}`;
  liquidity: bigint;
}

export async function indexPoolPositions(poolId: `0x${string}`, opts: { budgetMs?: number } = undefined as any): Promise<{ positions: V4Position[]; rows: V4ModifyRow[]; complete: boolean; ceiling: bigint } | null> {
  throw new NotImplementedInPublicBuild("lib/dex/v4-custody.ts#indexPoolPositions");
}

export type PoolStateAtBlock = { read: "ok"; liquidity: bigint; tick: number } | { read: "faulted" };

export const OWNED_SENDER_READ_MAX = 8;

export const _resolveOwnersForTests: any = (...args: any[]) => { throw new NotImplementedInPublicBuild("lib/dex/v4-custody.ts#_resolveOwnersForTests"); };

export async function readV4LpCustody(token: `0x${string}`, pool: PoolRef, deployer: string | null): Promise<LpCustody> {
  throw new NotImplementedInPublicBuild("lib/dex/v4-custody.ts#readV4LpCustody");
}