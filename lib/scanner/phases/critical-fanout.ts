// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { emitProgress, recordAdapterDiscoveryCoverage, recordAdapterSellCoverage, type ScanRunContext } from "../../observability/context";

import { reportError } from "../../observability/reporter";

import { isTrustedAddress } from "../../config/trusted-addresses";

import { runHoneypotChecks } from "../honeypot";

import { discoverExtraPools, aggregateAdapterSell, unsearchedProtocols } from "../../dex/registry";

import {
  readV4PoolManagerBalance,
  readV4PoolRefById,
  refreshV4DiscoveryIndex,
  censusInitializePoolsViaRpc,
  assessV4DiscoveryCoverage,
  mergeDiscoveredPools,
} from "../../dex/v4";

import { discoverCustodyPools } from "../../dex/discovery";

import { filterPoolCandidates } from "../entity";

import { indexDeployerLiquidityPulls, type LiquidityPullEvidence } from "../../dex/liquidity-pulls";

import { poolKeyOf, readPoolTokenAmounts, selectMaterialPools, v4Leftover } from "../../dex/pool-amounts";

import { isLaunchSidePool } from "../../dex/pool-tradeability";

import { disabledDexIds } from "../../config/dex-enablement";

import { probeTokenTransfer, applyV4TransferResidual, type TransferProbe } from "../../dex/transfer-probe";

import { curveTreatmentApplies, curveVenueReason } from "../venue";

import { poolDepthKey, prefetchPoolDepths } from "../checks/custody-materiality";

import {
  checkLpCustody,
  checkOwnership,
  checkUpgradeability,
  checkImpersonation,
  checkExplorerScamFlag,
  checkDeployerPulledLiquidity,
  checkFunderRugHistory,
  type ScanContext,
} from "../checks";

import { checkTokenConfirmedRug } from "../checks/critical-overrides";

import { pullLaunchSender } from "../checks/subject-origin";

import { assertRpcHealthy } from "../pipeline";

import { scanTimeLeftMs } from "../../rpc/provider-pool";

import type { PoolRef } from "../../dex/types";

import type { CheckResult, MarketSnapshot, TokenMeta } from "../../types";

import { flags } from "../../config/flags";

import { readLiquidityHistoryPools, enqueueLiquidityHistory, type HistoryQueuePool } from "../../data/pool-liquidity-history";

import { advancePoolLiquidityHistory, beginLiquidityHistorySnapshot, readLiquidityHistoryCoverage, syncLiquidityHistoryTails, type LiquidityHistoryCoverage, type LiquidityHistoryPool } from "../../dex/pool-liquidity-history";

export interface CriticalFanoutPhaseInput {
  scanCtx: ScanRunContext | undefined;
  address: `0x${string}`;
  market: MarketSnapshot | null;
  meta: TokenMeta;
  ctx: ScanContext;
}

export interface CriticalFanoutPhaseOutput {
  honeypot: Awaited<ReturnType<typeof runHoneypotChecks>>;
  honeypotResult: CheckResult;
  extraPools: PoolRef[];
  custodyDisc: Awaited<ReturnType<typeof discoverCustodyPools>>;
  criticals: CheckResult[];
  precomputed: {
    lpCustody: CheckResult;
    ownership: CheckResult;
    upgradeability: CheckResult;
  };
  liquidityHistoryDeferred: { reason: string; pools: number } | null;
}

export interface LiquidityHistoryPreflightResult {
  deferred: boolean;
  faulted: boolean;
  checked: number;
  reason: string | null;
}

export async function resolveChecksBeforeHistory(reads: readonly Promise<CheckResult>[], startHistory: () => Promise<void>): Promise<CheckResult[]> {
  throw new NotImplementedInPublicBuild("lib/scanner/phases/critical-fanout.ts#resolveChecksBeforeHistory");
}

export async function preflightLiquidityHistory(pools: readonly LiquidityHistoryPool[], options: {
    budgetMs?: number;
    now?: () => number;
    readCoverage?: (pools: readonly LiquidityHistoryPool[], budgetMs: number) => Promise<{ pools: Array<{ pool: LiquidityHistoryPool; coverage: LiquidityHistoryCoverage }> }>;
    advance?: (pool: LiquidityHistoryPool, budgetMs: number) => Promise<LiquidityHistoryCoverage>;
  } = undefined as any): Promise<LiquidityHistoryPreflightResult> {
  throw new NotImplementedInPublicBuild("lib/scanner/phases/critical-fanout.ts#preflightLiquidityHistory");
}

type SimRoute = { status?: string; reason?: string; evidence?: { protocol?: string; hookless?: boolean; hooks?: string; tradeable?: string; activeLiquidity?: string; sell?: { kind?: string }; buy?: { kind?: string } } };

export function isMeasuredHooklessDust(route: SimRoute): boolean {
  throw new NotImplementedInPublicBuild("lib/scanner/phases/critical-fanout.ts#isMeasuredHooklessDust");
}

export function applyAdapterEvidenceToV3Pass(result: CheckResult, adapterSell: Awaited<ReturnType<typeof aggregateAdapterSell>>, discoveryComplete: boolean, adapterSimulationFaulted: any = undefined as any, pools: readonly PoolRef[] = undefined as any, depths: ReadonlyMap<string, bigint | null> | null = undefined as any): void {
  throw new NotImplementedInPublicBuild("lib/scanner/phases/critical-fanout.ts#applyAdapterEvidenceToV3Pass");
}

export async function criticalFanoutPhase(S: CriticalFanoutPhaseInput): Promise<CriticalFanoutPhaseOutput> {
  throw new NotImplementedInPublicBuild("lib/scanner/phases/critical-fanout.ts#criticalFanoutPhase");
}