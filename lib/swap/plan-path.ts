// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { ROBINHOOD_CHAIN_ID } from "../config/chain";

import { assertPlanSafe, PlanGuardError } from "./plan-guard";

import { AUTO_SLIPPAGE_BPS, QUOTE_TTL_MS, USDG, type Candidate, type PlanContext } from "./plan-context";

import { measure, type MeasureContext } from "./plan-measure";

import { reverseApprovalCalls, settledFee, urApprovals } from "./plan-ur";

import { buildPathPlan, pathFeePoint, type PathLeg } from "./path-plan";

import { simulateRoundTrip } from "./simulate";

import { NATIVE, type Address, type PlanView, type RouteMetadata, type SimulationView, type SwapPlanResponse } from "./types";

export function reverseLegs(legs: readonly PathLeg[]): PathLeg[] {
  throw new NotImplementedInPublicBuild("lib/swap/plan-path.ts#reverseLegs");
}

export function pathRouteMetadata(tokenIn: Address, tokenOut: Address, legs: readonly PathLeg[]): RouteMetadata {
  throw new NotImplementedInPublicBuild("lib/swap/plan-path.ts#pathRouteMetadata");
}

export async function planViaPath(ctx: PlanContext, best: Candidate): Promise<SwapPlanResponse> {
  throw new NotImplementedInPublicBuild("lib/swap/plan-path.ts#planViaPath");
}