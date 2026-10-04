// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { Address, Hex } from "./types";

export interface ReviewedHookMetadata {
  chainId: number;
  address: Address;
  expectedRuntimeCodeHash: Hex;
  name?: string;
  acceptsEmptyHookData: boolean;
  supportedDeltaReturns?: boolean;
  allowProxy?: boolean;
  allowedPoolIds?: Hex[];
}

export const PONS_V2_REVIEWED_HOOK: ReviewedHookMetadata = {} as any;

export const ZIA_BRIDGE_REVIEWED_HOOK: ReviewedHookMetadata = {} as any;