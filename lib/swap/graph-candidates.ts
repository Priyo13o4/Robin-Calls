// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { PublicClient } from "viem";

import { ROBINHOOD_CHAIN_ID } from "../config/chain";

import { primeTrustedRegistry } from "../config/trusted-addresses";

import { assessHookForSwap, computeV4PoolId } from "./hook-admission";

import type { GraphRoute } from "./graph";

import { isFeeAsset, pathFeePoint, pathShapeError, type PathLeg } from "./path-plan";

import type { Candidate } from "./plan-context";

import { quoteRoutes, quoteRpcParams, type EthCall, type QuoteLeg } from "./route-quote";

import { toQuoteLeg } from "./route-quote-targets";

import { sharedRouteGraph } from "./route-graph-store";

import { EXECUTABLE_FAMILIES } from "./routes-api";

import { PANCAKE_INFINITY_UR, UNISWAP_UR, UNISWAP_V4_POOL_MANAGER, type UniversalRouterProfile } from "./venues";

import { NATIVE, type Address, type ExcludedVenue } from "./types";

import type { V4PoolKey } from "./ur-plan";

export interface GraphCandidatesInput {
  tokenIn: Address;
  tokenOut: Address;
  /** What the pools are asked to swap: net of an input fee, as every other candidate is quoted. */
  quoteAmountIn: bigint;
  feeBps: number;
  direction: "buy" | "sell";
  /** Verified stock tokens a route may pass through (resolveStockBridges). */
  approvedBridges: readonly Address[];
  /** Pool sequences other discovery already priced, keyed by `routePoolsKey`. */
  alreadyQuoted: ReadonlySet<string>;
  weth: Address;
  usdg: Address;
}

export interface GraphCandidatesDeps {
  routes?: typeof sharedRouteGraph.routes;
  prime?: () => Promise<void>;
  call?: EthCall;
  client?: PublicClient;
  assessHook?: typeof assessHookForSwap;
  quoteLeg?: typeof toQuoteLeg;
}

export type GraphCandidates =
  /** No graph, or it has never seen one of the tokens: discovery stands alone. Never "no route". */
  | { status: "unavailable"; reason: string }
  | { status: "ready"; candidates: Candidate[]; excluded: ExcludedVenue[]; complete: boolean; skipped: GraphSkips };

export type GraphSkips = Record<"router" | "middle" | "shape" | "noFee" | "duplicate" | "unquotable" | "hook" | "failed", number>;

export function graphSkipsSummary(s: GraphSkips): string {
  throw new NotImplementedInPublicBuild("lib/swap/graph-candidates.ts#graphSkipsSummary");
}

export const routePoolsKey = (pools: readonly string[]): any => {
  throw new NotImplementedInPublicBuild("lib/swap/graph-candidates.ts#routePoolsKey");
};

export function serverEthCall(client: PublicClient): EthCall {
  throw new NotImplementedInPublicBuild("lib/swap/graph-candidates.ts#serverEthCall");
}

export async function graphPathCandidates(input: GraphCandidatesInput, deps: GraphCandidatesDeps = undefined as any): Promise<GraphCandidates> {
  throw new NotImplementedInPublicBuild("lib/swap/graph-candidates.ts#graphPathCandidates");
}