// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { encodeFunctionData, parseAbi } from "viem";

import { ROBINHOOD_CHAIN_ID } from "../config/chain";

import type { AllowanceClient } from "./plan-context";

import type { Address, PlanStep } from "./types";

export function approveStep(token: Address, spender: Address, amount: bigint): PlanStep {
  throw new NotImplementedInPublicBuild("lib/swap/plan-approvals.ts#approveStep");
}

export function permitTypedData(args: {
  token: Address;
  spender: Address;
  permit2: Address;
  nonce: number;
  sigDeadline: bigint;
}): any {
  throw new NotImplementedInPublicBuild("lib/swap/plan-approvals.ts#permitTypedData");
}

export async function readAllowance(client: AllowanceClient, token: Address, owner: Address, spender: Address): Promise<bigint | null> {
  throw new NotImplementedInPublicBuild("lib/swap/plan-approvals.ts#readAllowance");
}

export async function readPermit2Allowance(client: AllowanceClient, permit2: Address, owner: Address, token: Address, spender: Address): Promise<readonly [bigint, number, number] | null> {
  throw new NotImplementedInPublicBuild("lib/swap/plan-approvals.ts#readPermit2Allowance");
}

export function resolveApprovalStep(token: Address, spender: Address, currentAllowance: bigint, neededAmount: bigint, targetAmount: bigint): PlanStep | null {
  throw new NotImplementedInPublicBuild("lib/swap/plan-approvals.ts#resolveApprovalStep");
}

export function createApprovalReader(client: AllowanceClient): any {
  throw new NotImplementedInPublicBuild("lib/swap/plan-approvals.ts#createApprovalReader");
}