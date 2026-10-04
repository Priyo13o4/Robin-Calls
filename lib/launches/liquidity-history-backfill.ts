// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { revalidatePath } from "next/cache";

import {
  claimLiquidityHistoryQueue,
  enqueueLiquidityHistory,
  readLiquidityHistoryCandidateTokens,
  readLiquidityHistoryPools,
  releaseLiquidityHistoryQueue,
  type LiquidityHistoryDiscoveredPool,
  type HistoryQueuePool,
} from "../data/pool-liquidity-history";

import { readPoolTokenAmounts, selectMaterialPools, poolKeyOf, MATERIAL_MAX } from "../dex/pool-amounts";

import { advancePoolLiquidityHistory, readLiquidityHistoryCoverage, type LiquidityHistoryCoverage, type LiquidityHistoryPool } from "../dex/pool-liquidity-history";

import { scanCoordinator } from "../scan-control";

import type { CachedScanResult, ScanCoordinator, TokenLockAcquisition } from "../scan-control/types";

import { scanToken, type ScanOutcome } from "../scanner/pipeline";

import { readTokenRecord } from "../scanner/record";

import { isOwnToken } from "../sale/token";

import { createScanContext, runWithScanContext, type ScanRunContext } from "../observability/context";

import { persistScanRun, type ScanRunSummary } from "../observability/scan-run";

import { reportError } from "../observability/reporter";

import { ledgerFromRow, ownTokenScanBody } from "../scan-control/serve";

export const LIQUIDITY_HISTORY_BACKFILL = {
  candidateLimit: 8,
  maxMaterialPools: MATERIAL_MAX,
  maxQueueItems: 4,
  runBudgetMs: 240_000,
  queueLeaseMs: 300_000,
  resultCacheSeconds: 900,
  minimumRescanBudgetMs: 150_000,
} as const;

export interface LiquidityHistoryBackfillSummary {
  candidates: number;
  seeded: number;
  queueItems: number;
  poolsAdvanced: number;
  completePools: number;
  rescanned: number;
  completed: number;
  deferred: number;
  skipped: number;
  stoppedReason: string | null;
}

type Candidate = { tokenAddress: string; priorityAmount: string };

type ClaimedQueueItem = {
  tokenAddress: string;
  pools: Array<HistoryQueuePool & { complete?: boolean }>;
  priorityAmount: string;
  revision: number;
  leaseToken: string;
  rescanRequested: boolean;
};

export interface LiquidityHistoryBackfillDeps {
  now?: () => number;
  readCandidates?: (limit: number) => Promise<Candidate[]>;
  readPools?: (tokenAddress: string) => ReturnType<typeof readLiquidityHistoryPools>;
  readAmounts?: typeof readPoolTokenAmounts;
  enqueue?: typeof enqueueLiquidityHistory;
  claim?: (now: Date, leaseMs: number) => Promise<ClaimedQueueItem | null>;
  release?: typeof releaseLiquidityHistoryQueue;
  advance?: (pool: LiquidityHistoryPool, opts: { budgetMs: number }) => Promise<LiquidityHistoryCoverage>;
  readCoverage?: (pools: readonly LiquidityHistoryPool[], opts: { budgetMs: number }) => Promise<{ safeHead: number | null; pools: Array<{ pool: LiquidityHistoryPool; coverage: LiquidityHistoryCoverage }> }>;
  coordinator?: ScanCoordinator | null | (() => ScanCoordinator | null);
  scan?: (tokenAddress: string, opts: { receiptBudget: { reserve: () => Promise<boolean>; release: () => Promise<void> } }) => Promise<ScanOutcome>;
  persistRun?: (ctx: ScanRunContext, summary: ScanRunSummary) => Promise<void>;
  publishResult?: (tokenAddress: string, outcome: ScanOutcome) => Promise<void>;
  report?: (input: { code: string; message: string; operation: string; tokenAddress?: string; error?: unknown }) => Promise<void>;
}

export function historyPoolsForQueue(refs: readonly LiquidityHistoryDiscoveredPool[], amounts: ReadonlyMap<string, bigint | null>): HistoryQueuePool[] {
  throw new NotImplementedInPublicBuild("lib/launches/liquidity-history-backfill.ts#historyPoolsForQueue");
}

export async function runLiquidityHistoryBackfill(deps: LiquidityHistoryBackfillDeps = undefined as any): Promise<LiquidityHistoryBackfillSummary> {
  throw new NotImplementedInPublicBuild("lib/launches/liquidity-history-backfill.ts#runLiquidityHistoryBackfill");
}

export function runLiquidityHistoryBackfillSingleFlight(deps?: LiquidityHistoryBackfillDeps): Promise<LiquidityHistoryBackfillSummary> {
  throw new NotImplementedInPublicBuild("lib/launches/liquidity-history-backfill.ts#runLiquidityHistoryBackfillSingleFlight");
}

export function resetLiquidityHistoryBackfillSingleFlightForTests(): void {
  throw new NotImplementedInPublicBuild("lib/launches/liquidity-history-backfill.ts#resetLiquidityHistoryBackfillSingleFlightForTests");
}