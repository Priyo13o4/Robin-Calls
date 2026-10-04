// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { ROBINHOOD_CHAIN_ID } from "../config/chain";

import { readAllowance, resolveApprovalStep } from "./plan-approvals";

import { AUTO_SLIPPAGE_BPS, QUOTE_TTL_MS, type PlanContext } from "./plan-context";

import { measure } from "./plan-measure";

import { withAmountOutMin, type SushiQuote } from "./sushi";

import { SUSHI_ROUTE_PROCESSOR } from "./venues";

import type { PlanStep, SimulationView, SwapPlanResponse } from "./types";

export async function planViaSushi(ctx: PlanContext, sushi: Extract<SushiQuote, { kind: "ok" }>): Promise<SwapPlanResponse> {
  throw new NotImplementedInPublicBuild("lib/swap/plan-sushi.ts#planViaSushi");
}