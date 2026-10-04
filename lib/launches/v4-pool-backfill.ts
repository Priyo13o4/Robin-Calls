// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { encodeAbiParameters, keccak256 } from "viem";

import { addresses } from "../config/chain";

import { v4InitializeEvent } from "../rpc/abis";

import { V4_POOLS_BACKFILL_STREAM } from "../data/v4-pools";

import {
  commitIngestWindow,
  initIngestCursor,
  IngestCursorMovedError,
  readIngestCursor,
  type IngestWindowCommit,
} from "../data/launches";

import type { V4PoolDraft } from "./types";

import { reportError } from "../observability/reporter";

import {
  adaptiveLogWalk,
  publicRpcClient,
  type AdaptiveWalkResult,
} from "../rpc/adaptive-walk";

export const V4_BACKFILL = {
  stream: V4_POOLS_BACKFILL_STREAM,
  /** Aim per call; the node refuses over 10,000 matches and viem refuses bodies over 10 MB. */
  targetLogs: 5_000,
  minWindow: 1_000,
  maxWindow: 2_000_000, // node hard cap is 10M; density makes anything wider useless
  initialWindow: 200_000,
  confirmations: 5,
  runBudgetMs: 240_000,
} as const;

export interface V4BackfillDeps {
  readCursor(stream: string): Promise<number | null>;
  initCursor(stream: string, next: number): Promise<void>;
  commit(c: IngestWindowCommit): Promise<void>;
  head(): Promise<number>;
  getLogs(from: number, to: number): Promise<V4PoolDraft[]>;
  now(): number;
}

export type V4BackfillResult = {
  calls: number;
  windows: number;
  pools: number;
  nextBlock: number;
  head: number;
  caughtUp: boolean;
  stopped: null | "budget" | "cursor-moved" | "rate-limited" | "window-floor";
};

export function toV4PoolDraft(log: {
  args?: {
    id?: unknown;
    currency0?: unknown;
    currency1?: unknown;
    fee?: unknown;
    tickSpacing?: unknown;
    hooks?: unknown;
  };
  blockNumber?: unknown;
  transactionHash?: unknown;
  txHash?: unknown;
}): V4PoolDraft {
  throw new NotImplementedInPublicBuild("lib/launches/v4-pool-backfill.ts#toV4PoolDraft");
}

export async function advanceV4PoolBackfill(deps?: Partial<V4BackfillDeps>): Promise<V4BackfillResult> {
  throw new NotImplementedInPublicBuild("lib/launches/v4-pool-backfill.ts#advanceV4PoolBackfill");
}