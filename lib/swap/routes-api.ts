// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { isAddress } from "viem";

import type { GraphRoute, RouteFamily } from "./graph";

import type { routeGraphStore } from "./route-graph-store";

import { primeTrustedRegistry } from "../config/trusted-addresses";

import { legTarget } from "./route-quote-targets";

import { isClPoolLeg } from "./route-quote";

export const EXECUTABLE_FAMILIES: readonly RouteFamily[] = [] as any;

export const VALUE_FAMILIES: readonly RouteFamily[] = [] as any;

export const ROUTES_PAGE_SIZE = 8;

export interface PublicRouteLeg {
  poolId: string;
  protocol: "v2" | "v3" | "v4";
  dex: string;
  fee: number | null;
  tickSpacing: number | null;
  hooks: string | null;
  tokenIn: string;
  tokenOut: string;
  /** What the quote lens calls for this leg (lib/swap/route-quote-targets.ts). Null = unquotable. */
  target: string | null;
}

export interface PublicRoute {
  key: string;
  family: RouteFamily;
  path: string[];
  bottleneckUsd: number;
  feePpm: number | null;
  decoy: boolean;
  legs: PublicRouteLeg[];
}

export type RoutesResponse =
  | { status: "ready"; routes: PublicRoute[]; known: { tokenIn: boolean; tokenOut: boolean }; stale: boolean; page: number }
  /** The graph could not be read: use /api/swap/plan's own discovery. Not "no route". */
  | { status: "unavailable" }
  | { status: "invalid"; error: string };

export function toPublicRoute(r: GraphRoute): PublicRoute {
  throw new NotImplementedInPublicBuild("lib/swap/routes-api.ts#toPublicRoute");
}

export async function answerRoutesRequest(params: URLSearchParams, store: ReturnType<typeof routeGraphStore>, prime: () => Promise<void> = undefined as any): Promise<RoutesResponse> {
  throw new NotImplementedInPublicBuild("lib/swap/routes-api.ts#answerRoutesRequest");
}