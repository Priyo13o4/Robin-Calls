// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { readGraphPools } from "../data/swap-pools";

import { NATIVE } from "./types";

import { WETH } from "./venues";

import { buildRouteGraph, findRoutes, type BuildOptions, type GraphPool, type GraphRoute, type RouteFamily, type RouteGraph, type SearchOptions } from "./graph";

export const GRAPH_MIN_DEPTH_USD = 250;

export const ROUTE_CACHE_DEPTH = 16;

export type StoredRoutes =
  | { status: "ready"; routes: GraphRoute[]; known: { tokenIn: boolean; tokenOut: boolean }; stale: boolean }
  /** No graph to search: the caller uses discovery. Never read as "no route". */
  | { status: "unavailable"; reason: "never_loaded" | "empty_graph" };

export interface RouteQuery {
  offset?: number;
  limit?: number;
  maxHops?: 1 | 2 | 3;
  families?: readonly RouteFamily[];
  /** Applied after the cache, so per-request dead-pool reports never poison other users' routes. */
  exclude?: ReadonlySet<string>;
}

interface StoreDeps {
  load?: () => Promise<GraphPool[]>;
  ttlMs?: number;
  now?: () => number;
  buildOptions?: BuildOptions;
  search?: typeof findRoutes;
}

export function routeGraphStore(deps: StoreDeps = undefined as any): any {
  throw new NotImplementedInPublicBuild("lib/swap/route-graph-store.ts#routeGraphStore");
}

export const sharedRouteGraph = routeGraphStore();