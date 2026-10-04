// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { keccak256, toBytes } from "viem";

import { decodeHookFlags, ZERO_ADDRESS, type DecodedHookFlags } from "./hook-admission";

import type { Address, PlanView } from "./types";

export interface HookWarningItem {
  address: Address;
  pool: Address | null;
  permissions: string[];
  dynamicFee: boolean;
  hookData: "unknown-empty-data-probe";
}

export function hookWarningsForPlan(plan: PlanView): HookWarningItem[] {
  throw new NotImplementedInPublicBuild("lib/swap/hook-runtime.ts#hookWarningsForPlan");
}

export function hookWarningPlanKey(plan: PlanView, account: Address): string {
  throw new NotImplementedInPublicBuild("lib/swap/hook-runtime.ts#hookWarningPlanKey");
}

export function canProceedWithHookStep(plan: PlanView, acknowledged: boolean, stepKind: "approve" | "permit2-sign" | "swap" | undefined): boolean {
  throw new NotImplementedInPublicBuild("lib/swap/hook-runtime.ts#canProceedWithHookStep");
}