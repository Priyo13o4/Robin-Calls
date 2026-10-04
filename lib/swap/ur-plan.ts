// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { concatHex, encodeAbiParameters, encodeFunctionData, encodePacked, parseAbi } from "viem";

import {
  ADDRESS_THIS,
  CONTRACT_BALANCE,
  MSG_SENDER,
  type UniversalRouterProfile,
} from "./venues";

import { NATIVE, type Address, type Hex, type SignedPermit } from "./types";

export const EXECUTE = {} as any;

export interface V4PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export interface UrLeg {
  protocol: "v2" | "v3" | "v4";
  /** V3 only. Pancake tiers are 100/500/2500/10000; a Uniswap 3000 assumption finds no pool. */
  feeTier?: number;
  v4Key?: V4PoolKey;
}

import {
  encodeSettle,
  encodeSwapExactInSingle,
  encodeTake,
  encodeV4SwapInput,
  V4_ACTION_SETTLE,
  V4_ACTION_SWAP_EXACT_IN_SINGLE,
  V4_ACTION_TAKE,
  v4Currency,
  v4PoolCurrency,
} from "./v4-plan";

export interface UrMultihopDetails {
  bridge: Address;
  leg1Protocol?: "v2" | "v3" | "v4";
  leg2Protocol?: "v2" | "v3" | "v4";
  leg1FeeTier?: number;
  leg2FeeTier?: number;
  leg1V4Key?: V4PoolKey;
  leg2V4Key?: V4PoolKey;
  approvedHookPoolKey?: V4PoolKey;
  approvedHookPoolKeys?: readonly V4PoolKey[];
}

export interface BuildUrPlanInput {
  profile: UniversalRouterProfile;
  leg: UrLeg;
  /** NATIVE (0x0) means the user pays in ETH. */
  tokenIn: Address;
  /** NATIVE (0x0) means the user receives ETH. */
  tokenOut: Address;
  amountIn: bigint;
  /** Enforced on chain by the delivering command. */
  minOut: bigint;
  /** Quoter figure before our fee; used only to state the fee, never to size a swap. */
  expectedOut: bigint;
  feeBps: number;
  feeRecipient: Address;
  deadline: bigint;
  /** A signed Permit2 allowance, when the router does not already have one. */
  permit?: SignedPermit | null;
  /** Two-hop path details for same-family Universal Router multihop execution */
  multihop?: UrMultihopDetails;
  approvedHookPoolKey?: V4PoolKey;
  approvedHookPoolKeys?: readonly V4PoolKey[];
  approvedExtraBridges?: readonly Address[];
}

export interface BuiltUrPlan {
  to: Address;
  data: Hex;
  value: bigint;
  /**
   * The asset PAY_PORTION actually moves, which on a sell for ETH is WETH and not the
   * native side the plan displays. The fee must be MEASURED in this one.
   */
  feePaidAsset: Address;
  commandNames: string[];
}

export function isQuoteAsset(token: Address, profile: UniversalRouterProfile, usdg?: Address): boolean {
  throw new NotImplementedInPublicBuild("lib/swap/ur-plan.ts#isQuoteAsset");
}

export function bridgeFeeApplies(tokenIn: Address, tokenOut: Address, bridge: Address | undefined, weth: Address, usdg: Address): boolean {
  throw new NotImplementedInPublicBuild("lib/swap/ur-plan.ts#bridgeFeeApplies");
}

export function payPortion(token: Address, recipient: Address, bips: number): Hex {
  throw new NotImplementedInPublicBuild("lib/swap/ur-plan.ts#payPortion");
}

export function sweep(token: Address, recipient: Address, amountMin: bigint): Hex {
  throw new NotImplementedInPublicBuild("lib/swap/ur-plan.ts#sweep");
}

export function permit2TransferFrom(token: Address, recipient: Address, amount: bigint): Hex {
  throw new NotImplementedInPublicBuild("lib/swap/ur-plan.ts#permit2TransferFrom");
}

export function permit2Permit(permit: SignedPermit): Hex {
  throw new NotImplementedInPublicBuild("lib/swap/ur-plan.ts#permit2Permit");
}

export function buildUrPlan(input: BuildUrPlanInput, usdg: Address): BuiltUrPlan {
  throw new NotImplementedInPublicBuild("lib/swap/ur-plan.ts#buildUrPlan");
}