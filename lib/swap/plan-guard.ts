// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, parseAbi } from "viem";

import {
  ADDRESS_THIS,
  CONTRACT_BALANCE,
  FLAG_ALLOW_REVERT,
  MSG_SENDER,
  type UniversalRouterProfile,
} from "./venues";

import { NATIVE, type Address, type Hex } from "./types";

import { USDG } from "./plan-context";

import { bridgeFeeApplies, type V4PoolKey } from "./ur-plan";

import { pathFeePoint, pathShapeError, type PathLeg } from "./path-plan";

import {
  V4_ACTION_SETTLE,
  V4_ACTION_SWAP_EXACT_IN_SINGLE,
  V4_ACTION_TAKE,
  V4_ACTION_TAKE_ALL,
  V4_SWAP_EXACT_IN_SINGLE_ABI,
  v4Currency,
  v4PoolCurrency,
} from "./v4-plan";

export class PlanGuardError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PlanGuardError";
    this.code = code;
  }
}

export interface GuardContext {
  profile: UniversalRouterProfile;
  /** What the user pays with, NATIVE allowed. */
  tokenIn: Address;
  /** What the user receives, NATIVE allowed. */
  tokenOut: Address;
  feeBps: number;
  feeRecipient: Address;
  /** The floor the plan must enforce on chain for the output leg. */
  minOut: bigint;
  nowSeconds: number;
  /** Exact authenticated V4 PoolKey admitted for this one route. */
  approvedHookPoolKey?: V4PoolKey;
  approvedHookPoolKeys?: readonly V4PoolKey[];
  v4Path?: readonly V4PoolKey[];
  /** Stock-token bridges authenticated from server-side registry/catalogue data. */
  approvedExtraBridges?: readonly Address[];
  /** When route is multihop, specify the expected route details */
  route?: {
    type: "direct" | "multihop" | "path";
    /** type "path" only: the exact pools, in order (lib/swap/path-plan.ts). */
    legs?: readonly PathLeg[];
    bridge?: Address;
    feeTiers?: number[];
    leg1Protocol?: "v2" | "v3" | "v4";
    leg2Protocol?: "v2" | "v3" | "v4";
    leg1FeeTier?: number;
    leg2FeeTier?: number;
    leg1V4Key?: V4PoolKey;
    leg2V4Key?: V4PoolKey;
  };
}

export interface DecodedCommand {
  index: number;
  byte: number;
  type: number;
  name: string;
  fields: readonly unknown[];
}

export interface DecodedSettle {
  action: number;
  currency: Address;
  amount: bigint;
  payerIsUser: boolean;
}

export interface DecodedSwapExactInSingle {
  action: number;
  poolKey: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  };
  zeroForOne: boolean;
  amountIn: bigint;
  amountOutMinimum: bigint;
  minHopPriceX36: bigint;
  hookData: Hex;
}

export interface DecodedTakeAll {
  action: number;
  currency: Address;
  minAmount: bigint;
}

export interface DecodedTake {
  action: number;
  currency: Address;
  recipient: Address;
  amount: bigint;
}

export type DecodedV4Param =
  | DecodedSettle
  | DecodedSwapExactInSingle
  | DecodedTakeAll
  | DecodedTake
  | { action: number; raw: Hex };

type AbiParam = { type: string };

export function decodePlan(profile: UniversalRouterProfile, data: Hex): {
  commands: DecodedCommand[];
  deadline: bigint | null;
} {
  throw new NotImplementedInPublicBuild("lib/swap/plan-guard.ts#decodePlan");
}

export function assertPlanSafe(data: Hex, ctx: GuardContext): DecodedCommand[] {
  throw new NotImplementedInPublicBuild("lib/swap/plan-guard.ts#assertPlanSafe");
}