// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { decodeFunctionResult, encodeFunctionData, type Hex } from "viem";

import { USDG } from "./plan-context";

import { WETH, UNISWAP_V4_POOL_MANAGER } from "./venues";

import { NATIVE } from "./types";

import { GRAPH_MIN_DEPTH_USD } from "./route-graph-store";

import { POOL_DEPTH_LENS_ABI, POOL_DEPTH_LENS_CODE } from "./pool-depth-lens";

import { rpc } from "../rpc/client";

import { redisClient } from "../redis/client";

import { toNumericString } from "../data/numeric";

import { readAnchorPools, readSweepPage, readHotSweepPools, upsertPoolDepths, type SweepPool, type SweepSource } from "../data/swap-pools";

import { reportError } from "../observability/reporter";

import type { ErrorCode } from "../observability/codes";

import type { poolDepth } from "../db/schema";

import { DIRTY_POOLS_KEY } from "../sequencer/liquidity-recorder";

import { getSqrtRatioAtTick } from "../launches/modules/v4-math";

export const DEPTH_BAND = 0.02;

export const BAND_TICKS = 203;

export const LENS_BATCH = 400;

export const ETH_USD_CACHE_KEY = "pool-depth:eth-usd";

export interface Measured {
  poolId: string;
  protocol: "v2" | "v3" | "v4";
  token0: string;
  token1: string;
  /** Raw token1 per raw token0 at the pool's current price. Null = empty or uninitialised. */
  price1Per0: number | null;
  out0: bigint;
  out1: bigint;
  /** The lens hit its tick cap: depth is unreliable in either direction, so the pool is faulted. */
  truncated: boolean;
  liquidity: bigint | null;
  sqrtPriceX96: bigint | null;
  reserve0: bigint | null;
  reserve1: bigint | null;
}

export interface LensReq { kind: number; pool: Hex; id: Hex; spacing: number }

export interface LensRes { ok: boolean; truncated: boolean; a: bigint; b: bigint; tick: number; ticks: readonly number[]; nets: readonly bigint[] }

export interface DepthSweepResult {
  tier: "full" | "hot";
  pools: number;
  measured: number;
  faulted: number;
  truncated: number;
  priced: number;
  unpriced: number;
  zero: number;
  calls: number;
  ms: number;
}

export interface MeasureDeps {
  lens?: (reqs: LensReq[]) => Promise<LensRes[]>;
}

export interface SweepDeps extends MeasureDeps {
  readPage?: (source: SweepSource, after: string | null, limit: number) => Promise<SweepPool[]>;
  readHot?: (minDepthUsd: number, extra: readonly string[]) => Promise<SweepPool[]>;
  readAnchors?: () => Promise<SweepPool[]>;
  popDirty?: (count: number) => Promise<string[]>;
  upsertDepths?: (rows: (typeof poolDepth.$inferInsert)[]) => Promise<void>;
  getEthUsd?: () => Promise<number | null>;
  setEthUsd?: (price: number) => Promise<void>;
  now?: () => Date;
  pageSize?: number;
}

export const sqrtAtTick = getSqrtRatioAtTick;

export function walkBand(sqrtP: bigint, tick: number, liquidity: bigint, ticks: readonly number[], nets: readonly bigint[], band: any = undefined as any): { out0: bigint; out1: bigint } | null {
  throw new NotImplementedInPublicBuild("lib/swap/depth-refresh.ts#walkBand");
}

export function v2Band(r0: bigint, r1: bigint, band: any = undefined as any): { out0: bigint; out1: bigint } {
  throw new NotImplementedInPublicBuild("lib/swap/depth-refresh.ts#v2Band");
}

export function measuredFromLens(pool: SweepPool, r: LensRes): Measured | null {
  throw new NotImplementedInPublicBuild("lib/swap/depth-refresh.ts#measuredFromLens");
}

export async function measurePools(pools: readonly SweepPool[], deps: MeasureDeps = undefined as any): Promise<{ measured: Measured[]; faulted: string[]; calls: number }> {
  throw new NotImplementedInPublicBuild("lib/swap/depth-refresh.ts#measurePools");
}

export type Sides = { depth0Usd: number | null; depth1Usd: number | null };

export const PRICE_BACKING_MIN_USD = GRAPH_MIN_DEPTH_USD;

export type TokenPrices = Map<string, { usdPerRaw: number; sourceUsd: number }>;

export function computeEthUsd(measured: readonly Measured[], fallback?: number | null): number | null {
  throw new NotImplementedInPublicBuild("lib/swap/depth-refresh.ts#computeEthUsd");
}

type Known = { usd: number; cap: number } | null;

export function priceAnchored(measured: readonly Measured[], ethUsd: number | null, prices: TokenPrices): { sides: Map<string, Sides | null>; rest: Measured[] } {
  throw new NotImplementedInPublicBuild("lib/swap/depth-refresh.ts#priceAnchored");
}

export function priceRest(rest: readonly Measured[], prices: TokenPrices, ethUsd: number | null = undefined as any): Map<string, Sides | null> {
  throw new NotImplementedInPublicBuild("lib/swap/depth-refresh.ts#priceRest");
}

export function priceDepths(measured: readonly Measured[], ethUsdFallback?: number | null): Map<string, Sides | null> {
  throw new NotImplementedInPublicBuild("lib/swap/depth-refresh.ts#priceDepths");
}

interface Tally { pools: number; measured: number; faulted: number; truncated: number; priced: number; unpriced: number; zero: number; calls: number }

export async function runDepthSweep(tier: "full" | "hot", deps: SweepDeps = undefined as any): Promise<DepthSweepResult> {
  throw new NotImplementedInPublicBuild("lib/swap/depth-refresh.ts#runDepthSweep");
}

export type PoolDepthJobOutcome =
  | { status: "done"; result: DepthSweepResult }
  | { status: "empty"; result: DepthSweepResult }
  | { status: "skipped" };

export async function runPoolDepthJob(tier: "full" | "hot", deps: SweepDeps & { report?: (code: ErrorCode, message: string) => Promise<void> } = undefined as any): Promise<PoolDepthJobOutcome> {
  throw new NotImplementedInPublicBuild("lib/swap/depth-refresh.ts#runPoolDepthJob");
}