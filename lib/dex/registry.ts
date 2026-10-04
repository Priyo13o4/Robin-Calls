// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { flags } from "../config/flags";

import { addresses, isAddressConfigured } from "../config/chain";

import { dexById, primaryDeployment } from "../config/dex-registry";

import type { DexAdapter, PoolRef, SellSim } from "./types";

import { uniswapV2Adapter } from "./v2";

import { uniswapV4Adapter, readV4LiquidityBatch } from "./v4";

import { simulateSellV3 } from "./v3";

import { runV2SellSim } from "./v2-sim";

import { isLaunchSidePool, isUntradeableFee, isUntradeablePool } from "./pool-tradeability";

export async function prioritizePools(pools: readonly PoolRef[]): Promise<PoolRef[]> {
  throw new NotImplementedInPublicBuild("lib/dex/registry.ts#prioritizePools");
}

export function orderPoolsByDepth(pools: readonly PoolRef[], depths: ReadonlyMap<string, bigint | null>): PoolRef[] {
  throw new NotImplementedInPublicBuild("lib/dex/registry.ts#orderPoolsByDepth");
}

export function enabledAdapters(): DexAdapter[] {
  throw new NotImplementedInPublicBuild("lib/dex/registry.ts#enabledAdapters");
}

export function unsearchedProtocols(): string[] {
  throw new NotImplementedInPublicBuild("lib/dex/registry.ts#unsearchedProtocols");
}

export interface ExtraPoolDiscovery {
  pools: PoolRef[];
  /**
   * False when any adapter's discovery faulted, so `pools` may be short.
   *
   * This matters because an EMPTY pool set is load-bearing in the honeypot
   * path: the CRITICAL→WARN downgrade is gated on `pools.length > 0`, so a
   * faulted discovery silently withheld the downgrade and left a sellable
   * token labelled a honeypot. An empty set from a fault is not the same fact
   * as an empty set from a token that genuinely trades nowhere else (§4).
   */
  complete: boolean;
  /**
   * True only when EVERY adapter reported a whole sweep (KNOWN-PROBLEMS L6).
   *
   * Deliberately separate from `complete`. That one means "no adapter threw"
   * and feeds `assertRpcHealthy`, which voids the scan with a 503 and records
   * no verdict — the right response to knowing nothing, and much too harsh for
   * knowing most of it. A truncated explorer page is routine on V4, the venue
   * that now carries whole tokens on its own, so a partial sweep degrades the
   * custody conclusion (UNKNOWN, disclosed on the receipt) and still publishes.
   *
   * Collapsing the two is what the old `catch`-only flag did from the other
   * side: the V4 adapter swallowed its own fault, so a short list was reported
   * as a clean one.
   */
  sweepComplete: boolean;
  /** L44 — protocols whose sweep went short or threw, so consumers can name them. */
  incompleteLegs: string[];
  /**
   * L184 — protocols this registry knows about but did NOT search, because
   * their flag is off or their addresses are unconfigured.
   *
   * Deliberately NOT folded into `complete`: that one voids the whole scan
   * through `assertRpcHealthy`, and a venue nobody enabled is not an RPC
   * outage. It is an exclusion, and every exclusion is an all-clear (§8 #13) —
   * so a consumer that publishes "no pool anywhere can fill this" must read
   * this list, not just `complete`.
   */
  unsearched: string[];
}

export async function discoverExtraPools(token: `0x${string}`, opts: { skip?: readonly string[] } = undefined as any): Promise<ExtraPoolDiscovery> {
  throw new NotImplementedInPublicBuild("lib/dex/registry.ts#discoverExtraPools");
}

export type SellRoute =
  | { kind: "primary-v4" }
  | { kind: "skip" }
  /** Any V2 pool, primary or foreign: sim against `router` + the pool's quote asset. */
  | { kind: "v2"; router: `0x${string}`; weth: `0x${string}` }
  /** Any non-WETH-primary / foreign V3 pool: sim against `swapRouter` + the pool's quote asset. */
  | { kind: "v3"; swapRouter: `0x${string}`; weth: `0x${string}` };

export function resolveSellRoute(pool: PoolRef): SellRoute {
  throw new NotImplementedInPublicBuild("lib/dex/registry.ts#resolveSellRoute");
}

export type QuoteRoute =
  | { kind: "v4" }
  | { kind: "skip" }
  | { kind: "v2"; router: `0x${string}`; quoteAsset: `0x${string}` }
  | { kind: "v3"; quoter: `0x${string}`; quoteAsset: `0x${string}` };

export function resolveQuoteRoute(pool: PoolRef): QuoteRoute {
  throw new NotImplementedInPublicBuild("lib/dex/registry.ts#resolveQuoteRoute");
}

export async function aggregateAdapterSell(token: `0x${string}`, pools: readonly PoolRef[], deps: {
    prioritize?: (pools: readonly PoolRef[]) => Promise<PoolRef[]>;
    simulate?: (token: `0x${string}`, pool: PoolRef) => Promise<SellSim | null>;
    maxAttempts?: number;
    poolSetComplete?: boolean;
  } = undefined as any): Promise<SellSim | null> {
  throw new NotImplementedInPublicBuild("lib/dex/registry.ts#aggregateAdapterSell");
}

export interface AlternativeRouteSummary {
  routeId?: string;
  protocol?: string;
  pool?: string;
  poolId?: string;
  feeTier?: number;
  status: string;
  reason: string;
  fault?: boolean;
  revert?: boolean;
  clearOrInconclusiveReason?: string;
}

export function formatAlternativeRoute(s: SellSim): AlternativeRouteSummary {
  throw new NotImplementedInPublicBuild("lib/dex/registry.ts#formatAlternativeRoute");
}

export function isZeroLiquidityOrUntradeableSim(s: SellSim): boolean {
  throw new NotImplementedInPublicBuild("lib/dex/registry.ts#isZeroLiquidityOrUntradeableSim");
}

export function foldSells(sims: SellSim[], coverage: {
    complete?: boolean;
    poolSetComplete?: boolean;
    omittedPools?: number;
    attempted?: number;
    candidateCount?: number;
    entryPoolIdentitySupported?: boolean;
  } = undefined as any): SellSim | null {
  throw new NotImplementedInPublicBuild("lib/dex/registry.ts#foldSells");
}