// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { ChainReader } from "../rpc/client";

export interface LockTerms {
  status: "resolved" | "unreadable";
  lockId: string | null;
  lockOwner: string | null;
  unlockDate: number | null;
  isEternal: boolean;
  adapter: string | null;
  why: "no-adapter" | "read-fault" | "no-lock-for-pool" | null;
  nftPositionManager?: string | null;
  nftId?: string | null;
}

export interface UncxLockPrimitive {
  lockId: bigint;
  nftPositionManager: string;
  pool: string;
  nftId: bigint;
  owner: string;
  pendingOwner: string;
  additionalCollector: string;
  collectAddress: string;
  unlockDate: bigint;
  countryCode: number;
  ucf: bigint;
}

export function decodeUncxLock(raw: `0x${string}`): UncxLockPrimitive {
  throw new NotImplementedInPublicBuild("lib/dex/lock-terms.ts#decodeUncxLock");
}

export interface LockPrimitives {
  adapterFamily: "uncx-v3" | null;
  adapterLabel: string | null;
  rawLocks: ReadonlyArray<`0x${string}` | null> | null;
  eternalLockSentinel: bigint | null;
  pool: string;
  nftId: bigint | null;
}

export function classifyLockTerms(p: LockPrimitives): LockTerms {
  throw new NotImplementedInPublicBuild("lib/dex/lock-terms.ts#classifyLockTerms");
}

export async function readLockTerms(
  client: ChainReader,
  locker: string,
  pool: string,
  nftId: bigint | null,
): Promise<LockTerms> {
  throw new NotImplementedInPublicBuild("lib/dex/lock-terms.ts#readLockTerms");
}

export interface SeedTimelockPrimitives {
  label: string;
  pool: string;
  expectedPosm: string | null;
  posm: string | null;
  tokenId: bigint | null;
  releaseAt: number | null;
  released: boolean | null;
  treasury: string | null;
  positionPoolId: string | null;
}

export function classifySeedTimelock(p: SeedTimelockPrimitives): LockTerms {
  throw new NotImplementedInPublicBuild("lib/dex/lock-terms.ts#classifySeedTimelock");
}

export interface UncxV4LockEntry {
  lockId: bigint;
  owner: string;
  tokenId: bigint;
  poolKey: {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  };
  amount: bigint;
  unlockTime: bigint;
  collectAddress: string;
  isNFTized: boolean;
  ucf: bigint;
}

export interface UncxV4LockPrimitives {
  adapterLabel: string;
  locks: ReadonlyArray<UncxV4LockEntry | null> | null;
  eternalLockSentinel: bigint | null;
  posm: string | null;
  pool: string;
  nftId: bigint | null;
}

export function computeV4PoolIdFromKey(poolKey: {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}): string {
  throw new NotImplementedInPublicBuild("lib/dex/lock-terms.ts#computeV4PoolIdFromKey");
}

export function classifyUncxV4Locks(p: UncxV4LockPrimitives): LockTerms {
  throw new NotImplementedInPublicBuild("lib/dex/lock-terms.ts#classifyUncxV4Locks");
}

export interface UncxV2LockEntry {
  lockId: bigint;
  lpToken: string;
  amount: bigint;
  unlockDate: bigint;
  owner: string;
}

export interface UncxV2LockPrimitives {
  adapterLabel: string | null;
  locks: ReadonlyArray<UncxV2LockEntry | null> | null;
  pool: string;
}

export function classifyUncxV2Locks(p: UncxV2LockPrimitives): LockTerms {
  throw new NotImplementedInPublicBuild("lib/dex/lock-terms.ts#classifyUncxV2Locks");
}

export function lockStillProtects(terms: LockTerms | undefined, nowSeconds: number): boolean {
  throw new NotImplementedInPublicBuild("lib/dex/lock-terms.ts#lockStillProtects");
}

export interface MatchedLockState {
  lapsed: bigint;
  terms: { address: string; terms: LockTerms }[];
}

export async function readMatchedLockState(
  client: ChainReader,
  matched: readonly { address: string }[],
  byOwner: Map<string, bigint>,
  pool: string,
): Promise<MatchedLockState> {
  throw new NotImplementedInPublicBuild("lib/dex/lock-terms.ts#readMatchedLockState");
}
