// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { rpc } from "../../rpc/client";

import {
  npmAbi,
} from "../../rpc/abis";

import {
  addresses,
  isAddressConfigured,
} from "../../config/chain";

import { isTransientRpcError } from "../../rpc/fault";

import { reportError } from "../../observability/reporter";

import type {
  CheckResult,
  CheckStatus,
} from "../../types";

import { uniswapV2Adapter } from "../../dex/v2";

import { uniswapV3Adapter } from "../../dex/v3";

import { slipstreamAdapter } from "../../dex/slipstream";

import { uniswapV4Adapter } from "../../dex/v4";

import { whaleConfidence, type OwnerKind } from "../../dex/custody";

import { custodyThresholds } from "../../config/custody-thresholds";

import { dexes } from "../../config/dex-registry";

import { isCurveOnlyVenue, curveVenueReason } from "../venue";

import type { DexProtocol, LpCustody } from "../../dex/types";

import { effectiveLpFee, isUntradeableFee, UNTRADEABLE_LP_FEE } from "../../dex/pool-tradeability";

import { AssessedPool, CONSIDERABLE_ALTERNATE_POOL_SHARE, CustodyFinding, CustodyState, LOW_IMPACT_CUSTODY_WARN_DEDUCTION, applyLockTerms, applyMateriality, applyPoolOrigins, applyWhaleAudits, boundCustodyJobsByShare, buildAssessedPoolEntry, computeTokenCustodyCoverage, concentratedControlClaim, concentratedNote, deployerSubject, lockerPhrase, notTheDeployer, poolDepthKey, prefetchPoolDepths, protectedDisclosure, protectedLead, protectedShare, pullerKindLabel, pullerOf, shareKeyOf, v2CustodyFinding, CONCLUSIVE_DEEPEST_STATUSES, LargestPuller, POOL_MATERIAL_PCT, V4_CUSTODY_POOL_CAP, boundV4CustodyPools } from "./custody-materiality";

import { LIQUIDITY_THIN_USD, ScanContext, weightOf, weighted } from "./shared";

import { INAPPLICABLE_SKIP, LAUNCHPAD_BOOK_SIZE, NPM_ENUM_BUDGET, launchSideSenders } from "./subject-origin";

import { subjectFrom, subjectNounOf } from "../entity";

export function marketVenueName(dexId: string | null | undefined): string | null {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-findings.ts#marketVenueName");
}

export const PROTOCOL_LABEL: Record<string, string> = {} as any;

export function custodyVenueName(f: CustodyFinding): string {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-findings.ts#custodyVenueName");
}

export function controlClaim(kind: OwnerKind): string {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-findings.ts#controlClaim");
}

export function custodyStateLine(finding: CustodyFinding): string {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-findings.ts#custodyStateLine");
}

export const BIG_POOL_SHARE = 0.30;

export function resolveCustodyHeadline(material: readonly AssessedPool[], shares: Record<string, number>, measured: boolean): { status: CheckStatus; custodyState: CustodyState; reason: string; evidence: Record<string, unknown>; deductionOverride?: number } | null {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-findings.ts#resolveCustodyHeadline");
}

export interface MarketDeepestAnchor {
  poolAddress: string | null;
  /** The provider's venue id for `poolAddress`, e.g. "up-v3". Null if unsaid. */
  poolDexId: string | null;
  liquidityUsd: number | null;
  priceUsd: number | null;
  decimals: number | null;
}

export interface CustodyDisagreement {
  marketDeepest: string;
  /** Readable venue name for `marketDeepest`, null when the provider gave none.
   *  Published so the receipt names the venue the prose names. */
  marketDeepestVenue: string | null;
  marketLiquidityUsd: number | null;
  /** The FAILing read venues' share of the oracle's total liquidity once the
   *  unread deepest pool is sized in — null when it couldn't be computed. */
  readVenuesShare: number | null;
  action: "logged" | "softened-to-warn" | "all-clear-uncertified";
}

export function reconcileMarketAnchoredDeepest(headline: {
    status: CheckStatus;
    custodyState: CustodyState;
    reason: string;
    evidence: Record<string, unknown>;
    deductionOverride?: number;
  }, assessed: readonly AssessedPool[], depths: ReadonlyMap<string, bigint | null>, measured: boolean, market: MarketDeepestAnchor): { status: CheckStatus; reason: string; evidence: Record<string, unknown>; deductionOverride?: number } {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-findings.ts#reconcileMarketAnchoredDeepest");
}

export function poolCustodyFinding(custody: LpCustody, protocol: DexProtocol, deployer: string | null = undefined as any, launchSide: ReadonlySet<string> = undefined as any): CustodyFinding {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-findings.ts#poolCustodyFinding");
}

export async function checkLpCustody(ctx: ScanContext): Promise<CheckResult> {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/custody-findings.ts#checkLpCustody");
}