// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { simulateSwap, nativeDeltaExcludingGas, type WatchedBalance } from "./simulate";

import { wrapped, type PlanDeps } from "./plan-context";

import { NATIVE, type Address, type SimulationView } from "./types";

export interface MeasureContext {
  account: Address;
  tokenIn: Address;
  tokenOut: Address;
  router: Address;
  feeRecipient: Address;
  /** The asset the plan really pays the fee in, which is not always the displayed one. */
  feeAsset: Address;
  expectedFee: bigint;
  minOut: bigint;
  pendingApproval: boolean;
  /** PlanContext.unfunded: a run that can only fail is not sent. */
  unfunded?: string;
  extraHolders?: Address[];
  /** Every token a route holds between pools; each is watched for router residue. */
  intermediateTokens?: readonly Address[];
  blockNumber?: bigint;
  gasPrice?: bigint;
  /** Approvals batched with the swap (EIP-5792); simulated first, as the wallet will send them. */
  preCalls?: { to: Address; data: `0x${string}`; value: bigint }[];
}

export async function measure(tx: { to: Address; data: `0x${string}`; value: bigint }, ctx: MeasureContext, deps: PlanDeps): Promise<SimulationView> {
  throw new NotImplementedInPublicBuild("lib/swap/plan-measure.ts#measure");
}