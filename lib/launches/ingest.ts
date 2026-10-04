// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { decodeEventLog, toEventSelector, type AbiEvent, type Hex, type PublicClient } from "viem";

import { rpc } from "@/lib/rpc/client";

import { walkLogRange } from "@/lib/rpc/range-walk";

import { configuredPreferredLogSpan } from "@/lib/rpc/provider-pool";

import { addresses, isAddressConfigured } from "@/lib/config/chain";

import { clFactories, launchQuoteAssets, v2Factories, v3Factories } from "@/lib/config/dex-registry";

import { createScanContext, runWithScanContext } from "@/lib/observability/context";

import { reportError } from "@/lib/observability/reporter";

import { fetchTokenPairsBatch, pairToSnapshot, selectPair, type DexScreenerPair } from "@/lib/market/dexscreener";

import { readEnabledLauncherInstances } from "@/lib/data/launchpads";

import { readVerifiedRwaRegistry } from "@/lib/data/admin-trust";

import { recordCurvePollRun } from "@/lib/data/curve-poll-runs";

import {
  clearMissingMarketReadings,
  commitIngestWindow,
  initIngestCursor,
  readIngestCursor,
  readKnownLaunches,
  readListedRefreshSet,
  readMarketRefreshSet,
  readRemovalLockedTokens,
  readStateRefreshSet,
  upsertMarketReadings,
  upsertStateReadings,
  writeBlockAnchor,
  type HourlyTradeBucket,
  type MarketReading,
} from "@/lib/data/launches";

import { upsertSlowRugWatchRecord } from "@/lib/data/rugs";

import { chainEmptiedTokens } from "@/lib/market/chain-liquidity";

import { createBlockTimeResolver } from "./time-resolver";

import { LABEL_WINDOW_MS, TRACTION } from "./labels";

import { liquidityPulled, PULL_CONFIRM_READINGS } from "./liquidity-pulled";

import { LAUNCHER_MODULES, STATIC_FAMILIES } from "./modules";

import { PONS_POOL_PROOF_VERSION, resolvePonsGraduatedPool } from "./modules/pons-v2";

import type {
  ChainContracts,
  ChainLog,
  DecodeResult,
  IngestContext,
  KnownLaunch,
  LaunchDraft,
  LauncherFamily,
  LauncherInstance,
  LauncherModule,
  LogSubscription,
  StateResult,
  TradeDraft,
} from "./types";

export const INGEST = {
  stream: "launches",
  confirmations: 20,
  maxWindowBlocks: 300,
  minWindowBlocks: 125,
  /** Logs per window we aim under: ~4 MB, clear of viem's 10 MB body cap and the node's 10,000-log cap. */
  targetWindowLogs: 4_000,
  /** Pause after a dense window. The public node 429s on a rolling byte budget (measured 2026-09-15). */
  denseWindowPauseMs: 1_500,
  /** Minimum gap between this process's ingest getLogs calls, splits included. Back-to-back reads drew 429s on prod. */
  logCallSpacingMs: 2_000,
  /** Spacing when a narrow getLogs provider takes windows first (OrbitFlare: 10 rps, no byte budget, 2026-09-15). */
  narrowLogCallSpacingMs: 150,
  maxWindowsPerRun: 12,
  /** Under call_robincalls_job's `curl -m 30` (0092), leaving room for state + market refresh. */
  runBudgetMs: 20_000,
  /** Smallest window a result-capped query is split to before the window faults. */
  bisectFloor: 16n,
  tradedStateLimit: 240,
  healingStateLimit: 120,
  marketTokensPerRun: 60,
  // L179: Dedicated pass for 821 traction-clearing tokens to refresh them within ~14m rather than 115m.
  listedTokensPerRun: 60,
} as const;

export function nextIngestWindow(current: number, outcome: { logs: number } | "failed", cap: number = undefined as any): number {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#nextIngestWindow");
}

export function ingestWindowCap(preferred: number | null = undefined as any): number {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#ingestWindowCap");
}

export function ingestLogSpacingMs(cap: number): number {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#ingestLogSpacingMs");
}

export function paceIngestLogCall(spacingMs: number = undefined as any): Promise<void> {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#paceIngestLogCall");
}

export interface FamilySubscription {
  family: LauncherFamily;
  kind: "launch" | "trade";
  sub: LogSubscription;
}

export interface FetchQuery {
  addresses: string[] | null;
  topics: (string[] | null)[];
}

export function buildFetchPlan(subs: readonly FamilySubscription[]): FetchQuery[] {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#buildFetchPlan");
}

export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  logIndex: string;
  transactionHash: string;
  /** Present on this chain's nodes; absent on some providers. */
  blockTimestamp?: string;
}

export function routeLogs(raw: readonly RawLog[], subs: readonly FamilySubscription[]): Map<LauncherFamily, ChainLog[]> {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#routeLogs");
}

export function lookupKeys(byFamily: ReadonlyMap<LauncherFamily, readonly ChainLog[]>): { tokens: string[]; curveAddresses: string[]; poolRefs: string[] } {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#lookupKeys");
}

export function contextFrom(known: readonly KnownLaunch[]): IngestContext {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#contextFrom");
}

export function draftToKnown(d: LaunchDraft, createdAtIso: string | null): KnownLaunch {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#draftToKnown");
}

export function bucketTrades(trades: readonly TradeDraft[], ctx: IngestContext, timeOf: (block: number) => number | null): { buckets: HourlyTradeBucket[]; dropped: number } {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#bucketTrades");
}

export function emptyDecode(): DecodeResult {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#emptyDecode");
}

export function chainContracts(verifiedRwaAddresses: readonly string[] = undefined as any): ChainContracts {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#chainContracts");
}

export function activeModules(instances: readonly LauncherInstance[]): LauncherModule[] {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#activeModules");
}

export async function fetchLogs(client: PublicClient, q: FetchQuery, from: number, to: number): Promise<RawLog[]> {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#fetchLogs");
}

export function decodeAll(modules: readonly LauncherModule[], byFamily: ReadonlyMap<LauncherFamily, readonly ChainLog[]>, instances: readonly LauncherInstance[], chain: ChainContracts, ctx: IngestContext): DecodeResult {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#decodeAll");
}

export function subscriptionsFor(modules: readonly LauncherModule[], instances: readonly LauncherInstance[], chain: ChainContracts, kinds: readonly ("launch" | "trade")[] = undefined as any): FamilySubscription[] {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#subscriptionsFor");
}

export interface WindowSummary {
  fromBlock: number;
  toBlock: number;
  logs: number;
  launches: number;
  events: number;
  trades: number;
  untimedTrades: number;
  v4Pools: number;
}

export async function ingestWindow(client: PublicClient, modules: readonly LauncherModule[], instances: readonly LauncherInstance[], chain: ChainContracts, from: number, to: number): Promise<{ summary: WindowSummary; traded: Map<string, { launch: KnownLaunch; trades: number }> }> {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#ingestWindow");
}

export async function refreshState(client: PublicClient, modules: readonly LauncherModule[], launches: readonly KnownLaunch[]): Promise<{ read: number; unread: number }> {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#refreshState");
}

export function dedupeRefreshTokens(candidates: readonly string[], exclude: readonly string[], limit: number): string[] {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#dedupeRefreshTokens");
}

export async function refreshMarket(tokens: readonly string[]): Promise<{ read: number; missing: number; faulted: number; nominated: number }> {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#refreshMarket");
}

export type LaunchIngestResult =
  | {
      ok: true;
      started?: number;
      windows: WindowSummary[];
      nextBlock: number | null;
      head: number;
      state: { read: number; unread: number } | null;
      market: { read: number; missing: number; faulted: number; nominated: number } | null;
      degraded: string[];
    }
  | { ok: false; reason: string };

export function runLaunchIngest(): Promise<LaunchIngestResult> {
  throw new NotImplementedInPublicBuild("lib/launches/ingest.ts#runLaunchIngest");
}