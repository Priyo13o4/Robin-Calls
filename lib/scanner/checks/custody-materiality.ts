// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { Abi } from "viem";

import { rpc } from "../../rpc/client";

import { LaunchSideSenders, classifyByHook, launchHookSet, resolvePoolOrigin } from "../../dex/pool-origin";

import {
  erc20Abi,
  clPoolStateAbi,
  v3PoolStateAbi,
  v4StateViewAbi,
} from "../../rpc/abis";

import {
  addresses,
  isAddressConfigured,
} from "../../config/chain";

import { batchRead, valueOrNull, type BatchCall } from "../../rpc/multicall";

import type {
  CheckStatus,
} from "../../types";

import { whaleConfidence, type OwnerKind } from "../../dex/custody";

import { classifyWhaleAuthority } from "../../dex/whale-authority";

import { gradeHolderController, readHolderController, type HolderController } from "../../dex/holder-controller";

import { isVenueInfrastructure } from "../../dex/custody";

import { readLockTerms, type LockTerms } from "../../dex/lock-terms";

import { readFeeCollectionSummary, type FeeCollectionSummary } from "../../dex/lp-fee-collection";

import { flags } from "../../config/flags";

import { custodyThresholds } from "../../config/custody-thresholds";

import type {
  ContractAuditResult,
} from "../../audit/types";

import type { LpCustody, LpCustodyState, PoolRef } from "../../dex/types";

import { subjectNoun } from "../entity";

export type CustodyState =
  | LpCustodyState
  /** Deployer provably holds no live LP position for this token. */
  | "NOT_HELD"
  /** No pool exists — there is no custody to assess. */
  | "NO_POOL";

export interface CustodyFinding {
  status: CheckStatus;
  custodyState: CustodyState;
  reason: string;
  evidence: Record<string, unknown>;
}

export interface LargestPuller {
  address: string;
  pctOfPool: number;
  kind: OwnerKind;
}

export function pullerOf(custody: LpCustody): LargestPuller | null {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#pullerOf");
}

export function pullerKindLabel(kind: OwnerKind | undefined): string {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#pullerKindLabel");
}

export function notTheDeployer(custody: LpCustody, launchSide: ReadonlySet<string> = undefined as any): string {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#notTheDeployer");
}

export function deployerSubject(custody: LpCustody): { kind: OwnerKind; address: string | null } {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#deployerSubject");
}

export function protectedDisclosure(custody: LpCustody): string {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#protectedDisclosure");
}

export function protectedShare(custody: LpCustody): number {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#protectedShare");
}

export function protectedLead(custody: LpCustody, label: string): string {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#protectedLead");
}

export function lockerPhrase(evidence: Record<string, unknown>): { holder: string; tail: string } {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#lockerPhrase");
}

export const AUDIT_PENDING_TAIL = "" as any;

export function concentratedNote(kind: OwnerKind): string {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#concentratedNote");
}

export function concentratedControlClaim(kind: OwnerKind, pct: string, object: string): string {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#concentratedControlClaim");
}

export function v2CustodyFinding(custody: LpCustody, pool: PoolRef, deployer: string | null = undefined as any, launchSide: ReadonlySet<string> = undefined as any): CustodyFinding {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#v2CustodyFinding");
}

export const POOL_MATERIAL_PCT = 0.05;

export const V4_CUSTODY_POOL_CAP = {} as any;

export function boundV4CustodyPools(v4Pools: readonly PoolRef[], depths: ReadonlyMap<string, bigint | null>): { assess: PoolRef[]; skipped: PoolRef[] } {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#boundV4CustodyPools");
}

export function rankV4PoolsByLiquidity<T extends { pool: PoolRef; liquidity: bigint }>(ranked: readonly T[], cap: number): { assess: PoolRef[]; skipped: PoolRef[] } {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#rankV4PoolsByLiquidity");
}

export function boundCustodyJobsByShare<T extends { poolKey: string; adapter: string }>(jobs: readonly T[], depths: ReadonlyMap<string, bigint | null>): { assess: T[]; shed: T[] } {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#boundCustodyJobsByShare");
}

export interface AssessedPool {
  /** Contract that custodies the tokens: the pair, the V3 pool, or — for every
   *  V4 pool alike — the singleton PoolManager. Prose/evidence identity only;
   *  never a materiality key (see `poolKey`). */
  contract: string | null;
  /**
   * Per-POOL identity for depth and materiality: the V4 poolId, or the pool
   * contract for V2/V3. `contract` cannot serve here because every V4 pool of a
   * token shares one address (the singleton PoolManager), so keying shares by it
   * gave all of them one aggregated share — the bug this key exists to prevent.
   * Optional so a poolless finding (the deployer-book fallback) can omit it.
   */
  poolKey?: string | null;
  finding: CustodyFinding;
}

export const WHALE_AUDIT_MAX = 2;

export const POOL_ORIGIN_MAX = 6;

export function whaleAuditSubject(f: CustodyFinding): { address: string; kind: OwnerKind } | null {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#whaleAuditSubject");
}

export function applyWhaleAuditToFinding(f: CustodyFinding, audits: ReadonlyMap<string, ContractAuditResult | null>, controllers: ReadonlyMap<string, HolderController | null> = undefined as any): CustodyFinding {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#applyWhaleAuditToFinding");
}

export async function applyWhaleAudits(assessed: AssessedPool[], auditContract: ((address: string) => Promise<ContractAuditResult | null>) | null, depths: ReadonlyMap<string, bigint | null>, readController: (holder: string, hook: string | null) => Promise<HolderController | null> = undefined as any): Promise<void> {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#applyWhaleAudits");
}

export const LOCK_TERMS_MAX = 2;

export async function applyLockTerms(assessed: AssessedPool[], depths: ReadonlyMap<string, bigint | null>): Promise<void> {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#applyLockTerms");
}

export function shareKeyOf(a: { contract: string | null; poolKey?: string | null }): string | null {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#shareKeyOf");
}

export function buildAssessedPoolEntry(a: AssessedPool, materialSet: ReadonlySet<AssessedPool>, shares: Record<string, number>, measured: boolean): Record<string, unknown> {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#buildAssessedPoolEntry");
}

export function poolDepthKey(p: PoolRef): string {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#poolDepthKey");
}

export function selectMaterialPools<T extends { contract: string | null; poolKey?: string | null }>(assessed: readonly T[], shares: Record<string, number>): T[] {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#selectMaterialPools");
}

export function virtualTokenReserve(liquidity: bigint | null, sqrtPriceX96: bigint | null, tokenIsCurrency0: boolean): bigint | null {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#virtualTokenReserve");
}

export function tokenIsCurrency0(token: string, pool: PoolRef): boolean {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#tokenIsCurrency0");
}

export async function prefetchPoolDepths(token: string, pools: readonly PoolRef[]): Promise<Map<string, bigint | null>> {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#prefetchPoolDepths");
}

export function poolSharesOf(keys: readonly string[], depths: ReadonlyMap<string, bigint | null>): Record<string, number> | null {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#poolSharesOf");
}

export function applyMateriality(assessed: readonly AssessedPool[], depths: ReadonlyMap<string, bigint | null>): { material: AssessedPool[]; shares: Record<string, number>; measured: boolean } {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#applyMateriality");
}

export function computeTokenCustodyCoverage(assessed: readonly AssessedPool[], shares: Record<string, number>, measured: boolean): { coverageOk: boolean; attributedPct: number | null } {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#computeTokenCustodyCoverage");
}

export const CONSIDERABLE_ALTERNATE_POOL_SHARE = 0.1;

export const CONCLUSIVE_DEEPEST_STATUSES: ReadonlySet<string> = {} as any;

export const LOW_IMPACT_CUSTODY_WARN_DEDUCTION = 2;

export async function applyPoolOrigins(material: AssessedPool[], initTxByPoolId: ReadonlyMap<string, string>, launchSide: LaunchSideSenders, shares: Record<string, number> = undefined as any, hooksByPoolId: ReadonlyMap<string, string> = undefined as any): Promise<void> {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-materiality.ts#applyPoolOrigins");
}