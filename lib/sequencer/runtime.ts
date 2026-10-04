// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { randomUUID } from "node:crypto";

import { redisClient } from "@/lib/redis/client";

import { readEnabledLauncherInstances } from "@/lib/data/launchpads";

import { readBlockAnchors, readIngestCursor, readKnownLaunches, writeBlockAnchor } from "@/lib/data/launches";

import { enqueueSequencerWork, readSequencerWork, retrySequencerWork, completeSequencerWork, readSequencerCheckpoint, writeSequencerCheckpoint, commitSequencerEvidence, patchSequencerTokenMeta, readPendingLaunchEnrichment, applyLaunchEnrichment, recordSequencerMetric, pruneSequencerTelemetry, sanitizeSequencerError, commitCurveTradeWindow, type SequencerWork } from "@/lib/data/sequencer";

import { activeModules, chainContracts, subscriptionsFor, buildFetchPlan, decodeAll, routeLogs, lookupKeys, contextFrom, bucketTrades, type RawLog } from "@/lib/launches/ingest";

import { walkLogRange } from "@/lib/rpc/range-walk";

import { interpolateBlockTime } from "@/lib/launches/block-times";

import { createWindowTimestampResolver } from "@/lib/launches/time-resolver";

import { rpc } from "@/lib/rpc/client";

import { createScanContext, runWithScanContext } from "@/lib/observability/context";

import { cuCost } from "@/lib/rpc/cu-limiter";

import { recordCurvePollRun } from "@/lib/data/curve-poll-runs";

import { PONS_V2_ROUTER, PONS_V2_FACTORY, extractLaunchCalldata } from "./handlers/launches";

import { extractV4PoolKey } from "./handlers/v4-pools";

import { ponsConfirmedToLaunchDraft, mergePonsLaunchEvents, type PonsEvent } from "./pons-events";

import { PonsClient } from "./pons-client";

import { decodeConfirmedExecution, knownFromDraft, type ExecutionEvidence } from "./confirmed-events";

import { enrichNewLaunches } from "./enrichment";

import { recordTradeSenders } from "./trade-senders";

import { recordLiquidity, RECORD_INTERVAL_MS } from "./liquidity-recorder";

import { fetchCurveBuys, curveBuysByTx, FLAP_BUY_TOPIC } from "./launch-buys";

import { BOUGHT } from "@/lib/launches/modules/flap-v1";

import { fetchExecutionEvidence } from "./execution-provider";

import type { DecodedSequencerBatch } from "./types";

import type { SequencerClient } from "./client";

import type { KnownLaunch, LauncherInstance } from "@/lib/launches/types";

export const runtimeDeps = {} as any;

export const MAX_WORK_ATTEMPTS = 20;

export const RECOVERY_INTERVAL_MS = 120_000;

export async function enqueueSequencerBatch(batch: DecodedSequencerBatch): Promise<void> {
  throw new NotImplementedInPublicBuild("lib/sequencer/runtime.ts#enqueueSequencerBatch");
}

export async function enqueuePonsEvent(event: PonsEvent): Promise<void> {
  throw new NotImplementedInPublicBuild("lib/sequencer/runtime.ts#enqueuePonsEvent");
}

export async function persistExecution(evidence: ExecutionEvidence, workId?: string, source: "robinscan" | "blockscout" | "recovery" = undefined as any, requireGraduation: any = undefined as any): Promise<void> {
  throw new NotImplementedInPublicBuild("lib/sequencer/runtime.ts#persistExecution");
}

type PreparedExecution = { evidence: ExecutionEvidence; decoded: ReturnType<typeof decodeConfirmedExecution>; known: Awaited<ReturnType<typeof runtimeDeps.known>>; configs: LauncherInstance[] };

export async function scheduleRecovery(reason: string, includePons: boolean): Promise<void> {
  throw new NotImplementedInPublicBuild("lib/sequencer/runtime.ts#scheduleRecovery");
}

export function recordRpcSpend(label: string, ctx: ReturnType<typeof createScanContext>): void {
  throw new NotImplementedInPublicBuild("lib/sequencer/runtime.ts#recordRpcSpend");
}

export const ENRICH_INTERVAL_MS = 60_000;

export async function enrichPendingLaunches(now: any = undefined as any): Promise<{ resolved: number; unresolved: number }> {
  throw new NotImplementedInPublicBuild("lib/sequencer/runtime.ts#enrichPendingLaunches");
}

export function touchesAny(evidence: Pick<ExecutionEvidence, "logs">, launches: readonly KnownLaunch[]): boolean {
  throw new NotImplementedInPublicBuild("lib/sequencer/runtime.ts#touchesAny");
}

export function logTimestamp(log: { blockTimestamp?: string | null }): number | undefined {
  throw new NotImplementedInPublicBuild("lib/sequencer/runtime.ts#logTimestamp");
}

export async function processSequencerWork(work: SequencerWork): Promise<void> {
  throw new NotImplementedInPublicBuild("lib/sequencer/runtime.ts#processSequencerWork");
}

export const CURVE_TRADES_INTERVAL_MS = 120_000;

export function nextCurveTradeWindow(checkpoint: { nextBlock?: number } | Record<string, unknown> | null | undefined, head: number): { from: number; to: number } | null {
  throw new NotImplementedInPublicBuild("lib/sequencer/runtime.ts#nextCurveTradeWindow");
}

export async function recordCurveTrades(): Promise<{ windows: number; trades: number }> {
  throw new NotImplementedInPublicBuild("lib/sequencer/runtime.ts#recordCurveTrades");
}

export function startIngestionRuntime(client: SequencerClient): void {
  throw new NotImplementedInPublicBuild("lib/sequencer/runtime.ts#startIngestionRuntime");
}

export function stopIngestionRuntime(): void {
  throw new NotImplementedInPublicBuild("lib/sequencer/runtime.ts#stopIngestionRuntime");
}