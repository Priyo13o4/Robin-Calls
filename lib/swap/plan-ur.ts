// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { encodeFunctionData, maxUint256, parseAbi } from "viem";

import { ROBINHOOD_CHAIN_ID } from "../config/chain";

import { assertPlanSafe, PlanGuardError } from "./plan-guard";

import { permitTypedData, createApprovalReader, resolveApprovalStep } from "./plan-approvals";

import {
  AUTO_SLIPPAGE_BPS,
  isQuoteAsset,
  PERMIT_EXPIRY_SECONDS,
  QUOTE_TTL_MS,
  USDG,
  type Candidate,
  type PlanContext,
} from "./plan-context";

import { measure, type MeasureContext } from "./plan-measure";

import { bridgeFeeApplies, buildUrPlan } from "./ur-plan";

import { buildV4Plan } from "./v4-plan";

import { simulateRoundTrip } from "./simulate";

import { NATIVE, type Address, type Hex, type PlanStep, type PlanView, type SignedPermit, type SimulationView, type SwapPlanResponse } from "./types";

type PreCall = { to: Address; data: Hex; value: bigint };

export async function urApprovals(ctx: PlanContext, best: Candidate): Promise<{ steps: PlanStep[]; permit: SignedPermit | null; preCalls: PreCall[] } | { answer: SwapPlanResponse }> {
  throw new NotImplementedInPublicBuild("lib/swap/plan-ur.ts#urApprovals");
}

export function settledFee(probe: { feePaid: string; measuredOut: string }, at: "middle" | "output", feeBps: number): bigint | null {
  throw new NotImplementedInPublicBuild("lib/swap/plan-ur.ts#settledFee");
}

export function reverseApprovalCalls(token: Address, profile: Candidate["profile"], amount: bigint, nowSeconds: number): PreCall[] {
  throw new NotImplementedInPublicBuild("lib/swap/plan-ur.ts#reverseApprovalCalls");
}

export async function planViaUniversalRouter(ctx: PlanContext, best: Candidate): Promise<SwapPlanResponse> {
  throw new NotImplementedInPublicBuild("lib/swap/plan-ur.ts#planViaUniversalRouter");
}