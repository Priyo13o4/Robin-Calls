// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { concatHex, encodeAbiParameters, encodeFunctionData, type Hex } from "viem";

import { ADDRESS_THIS, CONTRACT_BALANCE, MSG_SENDER } from "./venues";

import { NATIVE, type Address } from "./types";

import {
  EXECUTE,
  isQuoteAsset,
  payPortion,
  permit2Permit,
  permit2TransferFrom,
  sweep,
  type BuildUrPlanInput,
  type BuiltUrPlan,
  type V4PoolKey,
} from "./ur-plan";

export const V4_ACTION_SWAP_EXACT_IN_SINGLE = 0x06;

export const V4_ACTION_SETTLE = 0x0b;

export const V4_ACTION_TAKE = 0x0e;

export const V4_ACTION_TAKE_ALL = 0x0f;

export const v4Currency = (t: Address): Address => {
  throw new NotImplementedInPublicBuild("lib/swap/v4-plan.ts#v4Currency");
};

export function v4PoolCurrency(token: Address, key: V4PoolKey, weth: Address): Address {
  throw new NotImplementedInPublicBuild("lib/swap/v4-plan.ts#v4PoolCurrency");
}

export const V4_SWAP_EXACT_IN_SINGLE_ABI = [
  {
    type: "tuple",
    components: [
      {
        type: "tuple",
        name: "poolKey",
        components: [
          { type: "address", name: "currency0" },
          { type: "address", name: "currency1" },
          { type: "uint24", name: "fee" },
          { type: "int24", name: "tickSpacing" },
          { type: "address", name: "hooks" },
        ],
      },
      { type: "bool", name: "zeroForOne" },
      { type: "uint128", name: "amountIn" },
      { type: "uint128", name: "amountOutMinimum" },
      { type: "uint256", name: "minHopPriceX36" },
      { type: "bytes", name: "hookData" },
    ],
  },
] as const;

export function encodeSettle(currency: Address, amount: bigint, payerIsUser: boolean): Hex {
  throw new NotImplementedInPublicBuild("lib/swap/v4-plan.ts#encodeSettle");
}

export function encodeSwapExactInSingle(poolKey: V4PoolKey, zeroForOne: boolean, amountIn: bigint, amountOutMinimum: bigint, minHopPriceX36: bigint, hookData: Hex): Hex {
  throw new NotImplementedInPublicBuild("lib/swap/v4-plan.ts#encodeSwapExactInSingle");
}

export function encodeTakeAll(currency: Address, minAmount: bigint): Hex {
  throw new NotImplementedInPublicBuild("lib/swap/v4-plan.ts#encodeTakeAll");
}

export function encodeTake(currency: Address, recipient: Address, amount: bigint): Hex {
  throw new NotImplementedInPublicBuild("lib/swap/v4-plan.ts#encodeTake");
}

export function encodeV4SwapInput(actions: number[], params: Hex[]): Hex {
  throw new NotImplementedInPublicBuild("lib/swap/v4-plan.ts#encodeV4SwapInput");
}

export function buildV4Plan(input: BuildUrPlanInput & { leg: { protocol: "v4"; v4Key: V4PoolKey }; v4Path?: readonly V4PoolKey[] }, usdg: Address, approvedHookPoolKey?: V4PoolKey, approvedHookPoolKeys: readonly V4PoolKey[] = undefined as any): BuiltUrPlan {
  throw new NotImplementedInPublicBuild("lib/swap/v4-plan.ts#buildV4Plan");
}