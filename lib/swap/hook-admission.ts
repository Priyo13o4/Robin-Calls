// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { encodeAbiParameters, isAddress, keccak256, type Address, type Hex } from "viem";

import type { V4PoolKey } from "./ur-plan";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const POOL_KEY_ABI = [{ type: "tuple", components: [
  { name: "currency0", type: "address" }, { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] }] as const;

export function computeV4PoolId(key: V4PoolKey): Hex {
  throw new NotImplementedInPublicBuild("lib/swap/hook-admission.ts#computeV4PoolId");
}

export interface DecodedHookFlags {
  rawBits: number;
  beforeInitialize: boolean; // 1 << 13
  afterInitialize: boolean; // 1 << 12
  beforeAddLiquidity: boolean; // 1 << 11
  afterAddLiquidity: boolean; // 1 << 10
  beforeRemoveLiquidity: boolean; // 1 << 9
  afterRemoveLiquidity: boolean; // 1 << 8
  beforeSwap: boolean; // 1 << 7
  afterSwap: boolean; // 1 << 6
  beforeDonate: boolean; // 1 << 5
  afterDonate: boolean; // 1 << 4
  beforeSwapReturnDelta: boolean; // 1 << 3
  afterSwapReturnDelta: boolean; // 1 << 2
  afterAddLiquidityReturnDelta: boolean; // 1 << 1
  afterRemoveLiquidityReturnDelta: boolean; // 1 << 0
  hasSwapCallbacks: boolean;
  hasDeltaReturns: boolean;
  hasLiquidityDeltaReturns: boolean;
}

export function decodeHookFlags(hooks: Address): DecodedHookFlags {
  throw new NotImplementedInPublicBuild("lib/swap/hook-admission.ts#decodeHookFlags");
}

export interface AssessHookInput {
  hookAddress: Address;
  poolKey?: V4PoolKey;
  poolId?: Hex;
  tokenIn: Address;
  tokenOut: Address;
  direction?: "buy" | "sell" | "exactIn" | "exactOut";
  amount?: bigint | string;
  chainId: number;
  forceRefresh?: boolean;
  verifyHashesOnReuse?: boolean;
  publicHooklist?: ReadonlySet<string>;
}

export type HookAdmissionDecision = "approved" | "denied" | "unknown";

export type HookAdmissionReasonCode = "HOOKLESS_POOL" | "SIMULATION_REQUIRED" | "INVALID_POOL_IDENTITY";

export interface HookAdmissionResult {
  /** approved means eligible to probe, NEVER permission to serve an untested swap. */
  decision: HookAdmissionDecision;
  reasonCode: HookAdmissionReasonCode;
  reasonProse: string;
  cacheStatus: "bypass" | "hit" | "miss" | "revalidated";
  evidence: {
    chainId: number;
    hookAddress: Address;
    poolId: Hex;
    flags: DecodedHookFlags;
    /** Dynamic fees live in PoolKey.fee, not in the hook address bits. */
    dynamicFee: boolean;
    hookDataCapability: "unknown" | "confirmed_empty_supported";
    isUniswapHooklistEntry: boolean;
  };
  downstreamRequirements: {
    exactUniversalRouterSimulationRequired: true;
    roundTripSimulationRequired: boolean;
    futureExitSafetyGuaranteed: false;
  };
}

export async function assessHookForSwap(input: AssessHookInput): Promise<HookAdmissionResult> {
  throw new NotImplementedInPublicBuild("lib/swap/hook-admission.ts#assessHookForSwap");
}