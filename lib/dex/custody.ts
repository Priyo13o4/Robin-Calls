// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { DEAD_ADDRESSES } from "../config/chain";

import { custodyThresholds } from "../config/custody-thresholds";

import { trustedLockerMap, type TrustedLocker } from "../config/lockers";

import { isTrustedAddress, trustedAddressCachePrimed } from "../config/trusted-addresses";

import { classifyAddress, isWalletKind, type EntityKind } from "../scanner/entity";

import type { LpCustodyState } from "./types";

import type { WhaleAuthority } from "./whale-authority";

export const coverageMinPct = (): any => {
  throw new NotImplementedInPublicBuild("lib/dex/custody.ts#coverageMinPct");
};

export function trustedLockers(): Set<string> {
  throw new NotImplementedInPublicBuild("lib/dex/custody.ts#trustedLockers");
}

export function lockersMatched(byOwner: Map<string, bigint>): TrustedLocker[] {
  throw new NotImplementedInPublicBuild("lib/dex/custody.ts#lockersMatched");
}

export function exemptOwners(extra: readonly (string | null | undefined)[] = undefined as any): Set<string> {
  throw new NotImplementedInPublicBuild("lib/dex/custody.ts#exemptOwners");
}

export type OwnerKind = EntityKind | null;

export async function classifyOwner(address: `0x${string}`): Promise<OwnerKind> {
  throw new NotImplementedInPublicBuild("lib/dex/custody.ts#classifyOwner");
}

export function whaleConfidence(kind: OwnerKind, whale?: WhaleAuthority | null): "FAIL" | "WARN" | "PASS" {
  throw new NotImplementedInPublicBuild("lib/dex/custody.ts#whaleConfidence");
}

export interface OwnerStake {
  address: `0x${string}`;
  /** Protocol-native amount: LP tokens (V2) or liquidity units (V3/V4). */
  amount: bigint;
}

export function foldStakes(stakes: readonly OwnerStake[]): Map<string, bigint> {
  throw new NotImplementedInPublicBuild("lib/dex/custody.ts#foldStakes");
}

export function largestNonExempt(byOwner: Map<string, bigint>, exempt: Set<string>): { address: `0x${string}`; amount: bigint } | null {
  throw new NotImplementedInPublicBuild("lib/dex/custody.ts#largestNonExempt");
}

export function sumFor(byOwner: Map<string, bigint>, addresses: Iterable<string>): bigint {
  throw new NotImplementedInPublicBuild("lib/dex/custody.ts#sumFor");
}

export function shareOf(part: bigint, whole: bigint): number {
  throw new NotImplementedInPublicBuild("lib/dex/custody.ts#shareOf");
}

export function floorPct(share: number): string {
  throw new NotImplementedInPublicBuild("lib/dex/custody.ts#floorPct");
}

export function pullableDeployerStake(byOwner: Map<string, bigint>, deployer: string | null): bigint {
  throw new NotImplementedInPublicBuild("lib/dex/custody.ts#pullableDeployerStake");
}

export interface CustodyMeasurement {
  /** False when the pool has no readable denominator (no supply / no liquidity). */
  measurable: boolean;
  burnedPct: number;
  lockedPct: number;
  /** Deployer's PULLABLE share — see pullableDeployerStake. 0 when unresolved. */
  deployerPct: number;
  /** Largest single NON-deployer non-exempt share; null when it couldn't be read. */
  whalePct: number | null;
  /**
   * Share of the denominator attributed to a known owner. V2 passes 1 whenever
   * the holder list read at all; V3/V4 pass the real indexed coverage.
   */
  coverageOk: boolean;
  /**
   * Share held by the pool's own hook — attributed, but NOT classifiable as a
   * wallet, a burn or a registered locker. V2/V3 have no such holder and pass 0.
   * Required, not optional: a default would silently reinstate the all-clear
   * this field exists to block on every caller that forgot it.
   */
  hookPct: number;
}

export function protectedPct(m: Pick<CustodyMeasurement, "burnedPct" | "lockedPct">): number {
  throw new NotImplementedInPublicBuild("lib/dex/custody.ts#protectedPct");
}

export function decideCustodyState(m: CustodyMeasurement): LpCustodyState {
  throw new NotImplementedInPublicBuild("lib/dex/custody.ts#decideCustodyState");
}

export function isVenueInfrastructure(address: string | null | undefined): "yes" | "no" | "unchecked" {
  throw new NotImplementedInPublicBuild("lib/dex/custody.ts#isVenueInfrastructure");
}