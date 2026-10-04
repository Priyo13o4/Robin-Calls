// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { GraphPool } from "../data/swap-pools";

export type { GraphPool };

export type GraphProtocol = GraphPool["protocol"];

export type RouteFamily = "uniswap" | "pancake" | "sushi" | "slipstream";

export interface RouteLeg {
  pool: GraphPool;
  /** The pool's own currency on each side, before aliasing: native vs WETH matters to the encoder. */
  tokenIn: string;
  tokenOut: string;
}

export interface GraphRoute {
  family: RouteFamily;
  legs: RouteLeg[];
  /** Graph nodes in order (aliases resolved). */
  path: string[];
  bottleneckUsd: number;
  /** Sum of static fees; null when any leg's fee is dynamic or unknown. */
  feePpm: number | null;
  /** Some leg charges a static fee above DECOY_FEE_PPM (KNOWN-PROBLEMS L220 item 1). */
  decoy: boolean;
  key: string;
}

export interface RouteSearch {
  routes: GraphRoute[];
  /** False = the graph has never seen this token: the caller falls back to discovery, never "no route". */
  known: { tokenIn: boolean; tokenOut: boolean };
}

export interface BuildOptions {
  /** Deepest pools kept per token pair PER FAMILY. */
  poolsPerPair?: number;
  /** e.g. { [native]: weth }: both sides become one node. */
  aliases?: Readonly<Record<string, string>>;
}

export interface SearchOptions {
  maxHops?: 1 | 2 | 3;
  limit?: number;
  /** Top-K neighbours of each end tried for 3-pool routes. A cost bound, not a claim of completeness. */
  fanout?: number;
  /** Pools per edge combined on 2 and 3 pool routes. */
  poolsPerEdge?: number;
  families?: readonly RouteFamily[];
  exclude?: ReadonlySet<string>;
}

export const DECOY_FEE_PPM = 10_000;

export const DYNAMIC_FEE_FLAG = 0x800000;

export function familyOfDex(dex: string): RouteFamily | null {
  throw new NotImplementedInPublicBuild("lib/swap/graph.ts#familyOfDex");
}

interface Edge { family: RouteFamily; pool: GraphPool }

export interface RouteGraph {
  readonly pools: number;
  readonly tokens: number;
  has(token: string): boolean;
  /** @internal */ readonly adj: ReadonlyMap<string, ReadonlyMap<string, readonly Edge[]>>;
  /** @internal neighbours ordered by their deepest pool, deepest first */ readonly ranked: ReadonlyMap<string, readonly string[]>;
  /** @internal */ node(token: string): string;
}

export function buildRouteGraph(pools: readonly GraphPool[], opts: BuildOptions = undefined as any): RouteGraph {
  throw new NotImplementedInPublicBuild("lib/swap/graph.ts#buildRouteGraph");
}

export function outDepth(pool: GraphPool, from: string, node: (t: string) => string): number {
  throw new NotImplementedInPublicBuild("lib/swap/graph.ts#outDepth");
}

export function compareRoutes(x: GraphRoute, y: GraphRoute): number {
  throw new NotImplementedInPublicBuild("lib/swap/graph.ts#compareRoutes");
}

export function findRoutes(graph: RouteGraph, tokenIn: string, tokenOut: string, opts: SearchOptions = undefined as any): RouteSearch {
  throw new NotImplementedInPublicBuild("lib/swap/graph.ts#findRoutes");
}