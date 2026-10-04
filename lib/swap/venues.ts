// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { Address, SwapFamily, SwapVenue } from "./types";

export const MSG_SENDER = "0x0000000000000000000000000000000000000001";

export const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";

export const CONTRACT_BALANCE = 1n << 255n;

export const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";

export const UNISWAP_V4_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";

export const FLAG_ALLOW_REVERT = 0x80;

export type UrCommandName =
  | "V3_SWAP_EXACT_IN"
  | "V2_SWAP_EXACT_IN"
  | "PERMIT2_TRANSFER_FROM"
  | "PERMIT2_PERMIT"
  | "SWEEP"
  | "PAY_PORTION"
  | "WRAP_ETH"
  | "UNWRAP_WETH";

export interface UniversalRouterProfile {
  venue: SwapVenue;
  family: SwapFamily;
  router: Address;
  /** The Permit2 THIS router pulls through. Not shared across families. */
  permit2: Address;
  weth: Address;
  commands: Record<UrCommandName, number>;
  /** Uniswap 0x7f, Pancake 0x3f. Used when decoding a plan back for the guard. */
  commandTypeMask: number;
  /** Uniswap's V3 input carries a trailing uint256[] of per-hop price bounds. Pancake's does not. */
  v3SwapFields: 5 | 6;
  /**
   * Same trailing array on the V2 leg. The path is an `address[]` on all three, despite
   * a stale upstream comment in both Pancake dispatchers saying `bytes`: the function
   * signature, not the comment, is what the router decodes.
   */
  v2SwapFields: 5 | 6;
  /** Command byte for V4_SWAP (0x10 on Uniswap UR). Null on Pancake where 0x10 is INFI_SWAP. */
  v4SwapCommand: number | null;
}

export const UNISWAP_UR: UniversalRouterProfile = {} as any;

export const PANCAKE_INFINITY_UR: UniversalRouterProfile = {} as any;

export const PANCAKE_V3_UR: UniversalRouterProfile = {} as any;

export const SUSHI_ROUTE_PROCESSOR = "0x8e6fd69a77e88ee20ba4b4fbd59dfcda3ec0e98a";

export const UR_PROFILES: readonly UniversalRouterProfile[] = [] as any;

export function profileForDex(dexId: string | null | undefined): UniversalRouterProfile | null {
  throw new NotImplementedInPublicBuild("lib/swap/venues.ts#profileForDex");
}