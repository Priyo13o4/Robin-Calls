// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { deployerIsShared } from "./subject-origin";

import type {
  CheckResult,
  CheckStatus,
} from "../../types";

import {
  explorer,
  TAX_TOGGLE_METHODS,
} from "../../explorer/blockscout";

import { isCurveOnlyVenue, curveVenueReason } from "../venue";

import type { PoolLiquidityFlow } from "../../dex/liquidity-pulls";

import { INAPPLICABLE_SKIP } from "./subject-origin";

import { LIQUIDITY_DEAD_USD, LIQUIDITY_THIN_USD, SKIP_EXPLORER, ScanContext, isInfraAsset, weighted } from "./shared";

import { computeEffectiveLiquidityDepth } from "../../market/dexscreener";

import { isDrained } from "../../dex/v4-reserves";

export function poolFlowClause(flow: PoolLiquidityFlow | null | undefined, pool?: string | null): {
  text: string;
  evidence: Record<string, unknown>;
} {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/market-checks.ts#poolFlowClause");
}

export { computeEffectiveLiquidityDepth };

export function chainCheckedLiquidity(ctx: ScanContext): {
  usd: number | null;
  quoteUsd: number | null;
  pool: string | null;
  drained: { pool: string; providerUsd: number } | null;
} {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/market-checks.ts#chainCheckedLiquidity");
}

export function checkLiquidityDepth(ctx: ScanContext): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/market-checks.ts#checkLiquidityDepth");
}

export function checkSourceVerification(ctx: ScanContext): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/market-checks.ts#checkSourceVerification");
}

export function checkFdvLiquidityRatio(ctx: ScanContext): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/market-checks.ts#checkFdvLiquidityRatio");
}

export function checkVolumeTurnover(ctx: ScanContext): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/market-checks.ts#checkVolumeTurnover");
}

export const WASH_THRESHOLDS = {
  /** Pools below this depth are too small for turnover to mean anything. */
  minLiquidityUsd: 5_000,
  /** volume ÷ liquidity — young pools (<72h) use the tighter pair. */
  turnoverFailYoung: 20,
  turnoverFail: 30,
  turnoverWarnYoung: 10,
  turnoverWarn: 15,
  /** trades per unique trader over 24h */
  densityFail: 6,
  /** a pool is "young" (tighter thresholds) below this age */
  youngPoolHours: 72,
  /** min 24h trades before buy/sell symmetry is worth reading */
  symmetryMinTrades: 200,
} as const;

export function checkWashTrading(ctx: ScanContext): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/market-checks.ts#checkWashTrading");
}

export function checkTaxManipulation(ctx: ScanContext): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/market-checks.ts#checkTaxManipulation");
}

export function checkPaidPromotion(ctx: ScanContext): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/market-checks.ts#checkPaidPromotion");
}

export function checkPoolAge(ctx: ScanContext): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/market-checks.ts#checkPoolAge");
}

export async function checkContractAge(ctx: ScanContext): Promise<CheckResult> {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/market-checks.ts#checkContractAge");
}

export const CREATOR_RAISE_FAIL_PCT = 0.5;

export const CREATOR_RAISE_WARN_PCT = 0.25;

export function checkBytecodeFingerprint(ctx: ScanContext): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/market-checks.ts#checkBytecodeFingerprint");
}