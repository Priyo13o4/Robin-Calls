// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { Address } from "./types";

import { parseSwapPoolHints, type SwapPoolHint } from "./pool-hints";

type Entry = { expires: number; value: SwapPoolHint[] };

export async function discoverClientPoolHints(tokenIn: Address, tokenOut: Address, signal?: AbortSignal): Promise<SwapPoolHint[]> {
  throw new NotImplementedInPublicBuild("lib/swap/client-discovery.ts#discoverClientPoolHints");
}

export function _resetClientPoolHintCacheForTests(): any {
  throw new NotImplementedInPublicBuild("lib/swap/client-discovery.ts#_resetClientPoolHintCacheForTests");
}