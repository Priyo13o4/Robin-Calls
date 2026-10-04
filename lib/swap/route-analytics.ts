// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { SwapPlanDiagnostic, SwapPlanResponse } from "./types";

export function buildSwapRouteAnalytics(result: SwapPlanResponse, diagnostic: SwapPlanDiagnostic | null, graphSearch: SwapPlanDiagnostic | null = undefined as any): Record<string, unknown> {
  throw new NotImplementedInPublicBuild("lib/swap/route-analytics.ts#buildSwapRouteAnalytics");
}

export function rpcMethodSummary(methodCounts: Record<string, number>, cost: (method: string) => number): { rpcMethods: string; rpcCu: number } {
  throw new NotImplementedInPublicBuild("lib/swap/route-analytics.ts#rpcMethodSummary");
}