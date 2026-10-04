// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { redisClient } from "@/lib/redis/client";

import { flags } from "@/lib/config/flags";

import { rpc } from "@/lib/rpc/client";

import { walkLogRange } from "@/lib/rpc/range-walk";

import { readSequencerCheckpoint, writeSequencerCheckpoint, recordSequencerMetric } from "@/lib/data/sequencer";

import { upsertSwapPools } from "@/lib/data/swap-pools";

import type { swapPools } from "@/lib/db/schema";

import { appendLiquidityHistoryStep } from "@/lib/data/pool-liquidity-history";

import { groupStepLogs, historyEventsFor } from "@/lib/dex/pool-liquidity-history";

import { appendNftOwnersForStep, managerTransferLogs } from "@/lib/dex/position-nft-owners";

import {
  LP_TOPICS,
  V3_COLLECT,
  decodeLpLog,
  decodePoolCreation,
  foldPool,
  type LpEvent,
  type PoolBirth,
  type PoolLpRecord,
  type RawLpLog,
} from "@/lib/trade/lp-events";

import { foldPositionDeltas } from "@/lib/trade/lp-positions";

import { commitPositionStep, type PositionCommit } from "@/lib/data/lp-positions";

export const STREAM = "liquidity";

export const POOL_PREFIX = "lp:pool:";

export const COVERAGE_KEY = "lp:coverage";

export const DIRTY_POOLS_KEY = "pool-depth:dirty";

export const POOL_TTL_S = 2 * 24 * 3600;

export const STEP_BLOCKS = 600;

export const RESYNC_BLOCKS = 216_000;

export const RECORD_INTERVAL_MS = 60_000;

export interface Coverage { epoch: number; through: number }

export type RecorderDeps = {
  head: () => Promise<number>;
  logs: (from: number, to: number) => Promise<RawLpLog[]>;
  registerPools: typeof upsertSwapPools;
  markDirty: (ids: string[]) => Promise<void>;
  checkpoint: typeof readSequencerCheckpoint;
  setCheckpoint: typeof writeSequencerCheckpoint;
  metric: typeof recordSequencerMetric;
  commitPositions?: typeof commitPositionStep;
  appendHistory?: (from: number, to: number, logs: readonly RawLpLog[]) => Promise<{ advanced: number; inserted: number }>;
  store: {
    read: (pools: readonly string[]) => Promise<(PoolLpRecord | null)[]>;
    write: (records: ReadonlyMap<string, PoolLpRecord>, coverage: Coverage) => Promise<void>;
  };
};

export const recorderDeps: RecorderDeps = {} as any;

export { historyEventsFor };

export async function recordLiquidityStep(deps: RecorderDeps = undefined as any): Promise<{ from: number; to: number; head: number; events: number; pools: number; pulls: number; positions?: PositionCommit["status"] } | null> {
  throw new NotImplementedInPublicBuild("lib/sequencer/liquidity-recorder.ts#recordLiquidityStep");
}

export async function recordLiquidity(maxSteps: any = undefined as any, deps: any = undefined as any): Promise<void> {
  throw new NotImplementedInPublicBuild("lib/sequencer/liquidity-recorder.ts#recordLiquidity");
}

export async function readCoverage(): Promise<Coverage | null> {
  throw new NotImplementedInPublicBuild("lib/sequencer/liquidity-recorder.ts#readCoverage");
}

export async function readPoolLiquidity(pool: string): Promise<{ coverage: Coverage; record: PoolLpRecord | null } | null> {
  throw new NotImplementedInPublicBuild("lib/sequencer/liquidity-recorder.ts#readPoolLiquidity");
}