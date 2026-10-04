// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { concatHex, encodeAbiParameters, encodeFunctionData, encodePacked } from "viem";

import { ADDRESS_THIS, CONTRACT_BALANCE, MSG_SENDER, type UniversalRouterProfile } from "./venues";

import { NATIVE, type Address, type Hex, type SignedPermit } from "./types";

import { EXECUTE, payPortion, permit2Permit, permit2TransferFrom, sweep, type BuiltUrPlan, type V4PoolKey } from "./ur-plan";

import { encodeSettle, encodeSwapExactInSingle, encodeTake, encodeV4SwapInput, V4_ACTION_SETTLE, V4_ACTION_SWAP_EXACT_IN_SINGLE, V4_ACTION_TAKE } from "./v4-plan";

export const MAX_PATH_LEGS = 3;

export interface PathLeg {
  protocol: "v2" | "v3" | "v4";
  /** Pool address (V2/V3) or V4 pool id. Display and route keys only; the calldata names tokens. */
  pool: string;
  /** The pool's own currencies: V4 may hold native ETH (0x0), V2/V3 always hold WETH. */
  tokenIn: Address;
  tokenOut: Address;
  /** V3 only. */
  feeTier?: number;
  /** V4 only. */
  v4Key?: V4PoolKey;
}

export interface BuildPathPlanInput {
  profile: UniversalRouterProfile;
  legs: readonly PathLeg[];
  /** NATIVE means the user pays in ETH. */
  tokenIn: Address;
  /** NATIVE means the user receives ETH. */
  tokenOut: Address;
  amountIn: bigint;
  minOut: bigint;
  feeBps: number;
  feeRecipient: Address;
  deadline: bigint;
  permit?: SignedPermit | null;
  usdg: Address;
}

export function sameAsset(a: Address, b: Address, weth: Address): boolean {
  throw new NotImplementedInPublicBuild("lib/swap/path-plan.ts#sameAsset");
}

export function isFeeAsset(token: Address, weth: Address, usdg: Address): boolean {
  throw new NotImplementedInPublicBuild("lib/swap/path-plan.ts#isFeeAsset");
}

export type PathFee =
  | { at: "input" }
  | { at: "output" }
  /** After leg `afterLeg`, in the asset that leg delivered. */
  | { at: "middle"; afterLeg: number };

export function pathFeePoint(tokenIn: Address, tokenOut: Address, legs: readonly Pick<PathLeg, "tokenOut">[], weth: Address, usdg: Address): PathFee | null {
  throw new NotImplementedInPublicBuild("lib/swap/path-plan.ts#pathFeePoint");
}

export function pathShapeError(tokenIn: Address, tokenOut: Address, legs: readonly PathLeg[], weth: Address): string | null {
  throw new NotImplementedInPublicBuild("lib/swap/path-plan.ts#pathShapeError");
}

export function buildPathPlan(input: BuildPathPlanInput): BuiltUrPlan {
  throw new NotImplementedInPublicBuild("lib/swap/path-plan.ts#buildPathPlan");
}