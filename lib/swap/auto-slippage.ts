// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { AUTO_SLIPPAGE_BPS, isQuoteAsset, wrapped } from "./plan-context";

import type { SwapPoolHint } from "./pool-hints";

import type { Address } from "./types";

export const AUTO_SLIPPAGE_MAX_BPS = 500;

export function autoSlippageBps(tokenIn: Address, tokenOut: Address, hints: readonly SwapPoolHint[] = undefined as any): number {
  throw new NotImplementedInPublicBuild("lib/swap/auto-slippage.ts#autoSlippageBps");
}