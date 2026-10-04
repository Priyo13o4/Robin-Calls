// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { FORMULA_VERSION, tierForScore, PRIOR_MARK_CAP, UNREAD_SURFACE_CLEAR_CAP, UNREAD_SURFACE_DEFER_WEIGHT, CUSTODY_UNREAD_CAP, TOTAL_WEIGHT, WASH_TRADING_FAIL_CAP, IMPERSONATION_MIMIC_CAP, unavailableChecks, unreadSurfaceWeight, custodySurfaceUnread } from "../../config/formula";

import { unreadSurfaceWeightThreshold } from "../../config/custody-thresholds";

import { emitProgress, type ScanRunContext } from "../../observability/context";

import {
  checkBytecodeFingerprint, checkContractAge, checkDangerousSelectors,
  checkDeployerHistory, checkFdvLiquidityRatio, checkFundingLineage,
  checkHolderConcentration, checkLaunchpadProvenance, checkLiquidityDepth,
  checkLpCustody, checkOwnership, checkPaidPromotion, checkPoolAge,
  checkSerialClone, checkSourceVerification, checkTaxManipulation,
  checkUpgradeability, checkVolumeTurnover, checkWashTrading,
  reconcileOwnershipWithAudit, reconcileUpgradeabilityWithAudit,
  scoreDangerousFunctions, type ScanContext,
} from "../checks";

import { reconcilePullHandoffWithCustody } from "../checks/critical-overrides";

import { withLaunchInsiderBuyEvidence } from "../checks/provenance-history";

import { priorHoneypotCheck, priorPumpDumpCheck } from "../record";

import { runServerContractAudit } from "../../audit/server-run";

import { assertExplorerHealthy } from "../pipeline";

import type { CheckResult, MarketSnapshot, TokenMark, TokenMeta, Verdict } from "../../types";

type AuditOut = Awaited<ReturnType<typeof runServerContractAudit>> | null;

export interface WeightedScorePhaseInput {
  scanCtx: ScanRunContext | undefined;
  ctx: ScanContext;
  auditPromise: Promise<AuditOut> | null;
  criticals: CheckResult[];
  marks: TokenMark[];
  meta: TokenMeta;
  address: string;
  market: MarketSnapshot | null;
  precomputed?: {
    lpCustody: CheckResult;
    ownership: CheckResult;
    upgradeability: CheckResult;
  };
}

export interface WeightedScorePhaseOutput {
  verdict: Verdict;
  unreadWeight: number;
}

export async function weightedScorePhase(S: WeightedScorePhaseInput): Promise<WeightedScorePhaseOutput> {
  throw new NotImplementedInPublicBuild("lib/scanner/phases/weighted-score.ts#weightedScorePhase");
}