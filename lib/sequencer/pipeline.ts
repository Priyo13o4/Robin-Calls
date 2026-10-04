// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { DecodedSequencerBatch } from "./types";

import type { LaunchDraft, V4PoolDraft } from "@/lib/launches/types";

import {
  evaluateV4PoolTransaction,
  type TradeTickerItem,
} from "./handlers/v4-pools";

import { evaluateLaunchTransaction } from "./handlers/launches";

import {
  SequencerCursor,
  type GapDetectionResult,
} from "./cursor";

import {
  type HourlyTradeBucket,
} from "@/lib/data/launches";

import { revalidatePath } from "next/cache";

export interface PipelineBatchResult {
  sequenceNumber: number;
  blockNumber?: number;
  v4Pools: V4PoolDraft[];
  launches: LaunchDraft[];
  trades: TradeTickerItem[];
  hourlyTrades: HourlyTradeBucket[];
  gapDetected: boolean;
}

export interface SequencerPipelineOptions {
  poolManagerAddress?: string;
  cursor?: SequencerCursor;
  persistToDb?: boolean;
  onDiscovery?: (batch: DecodedSequencerBatch) => Promise<void>;
  onV4Pools?: (pools: V4PoolDraft[]) => Promise<void> | void;
  onLaunches?: (launches: LaunchDraft[]) => Promise<void> | void;
  onTrades?: (trades: TradeTickerItem[]) => Promise<void> | void;
  onHourlyTrades?: (hourly: HourlyTradeBucket[]) => Promise<void> | void;
  onGap?: (gap: GapDetectionResult) => void;
}

export function aggregateTradesToHourly(trades: readonly TradeTickerItem[]): HourlyTradeBucket[] {
  throw new NotImplementedInPublicBuild("lib/sequencer/pipeline.ts#aggregateTradesToHourly");
}

export class SequencerPipeline {

  constructor(..._args: any[]) {
    throw new NotImplementedInPublicBuild("lib/sequencer/pipeline.ts#SequencerPipeline");
  }

  getCursor(): SequencerCursor {
    throw new NotImplementedInPublicBuild("lib/sequencer/pipeline.ts#SequencerPipeline.getCursor");
  }

  async processBatch(batch: DecodedSequencerBatch): Promise<PipelineBatchResult> {
    throw new NotImplementedInPublicBuild("lib/sequencer/pipeline.ts#SequencerPipeline.processBatch");
  }

}

export function createSequencerPipeline(options?: SequencerPipelineOptions): SequencerPipeline {
  throw new NotImplementedInPublicBuild("lib/sequencer/pipeline.ts#createSequencerPipeline");
}