// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { PoolRef } from "./types";
import type { ChainReader } from "../rpc/client";

export type QuoteDirection = "buy" | "sell";

export const QUOTE_CONCURRENCY = 40;
export const QUOTE_POOL_MAX = 200;

export interface VenueQuote {
  dexId: string;
  protocol: PoolRef["protocol"];
  pool: `0x${string}`;
  poolId?: `0x${string}`;
  feeTier: number;
  quoteAsset: `0x${string}`;
  amountIn: string;
  amountOut: string;
  gasEstimate?: string;
  v4Key?: {
    currency0: `0x${string}`;
    currency1: `0x${string}`;
    fee: number;
    tickSpacing: number;
    hooks: `0x${string}`;
  };
}

export interface TokenQuote {
  enabled: boolean;
  quotes: VenueQuote[];
  best: VenueQuote | null;
  bestByQuoteAsset: Record<string, VenueQuote>;
  complete: boolean;
  unsearched: string[];
  poolsUnquoted: number;
  skippedHookPools?: number;
}

export interface QuoteSearchOptions {
  authenticatedPools?: readonly PoolRef[];
  skipV4HookPools?: boolean;
  verifiedCandidatePools?: readonly PoolRef[];
  maxPools?: number;
  concurrency?: number;
  skipV4Sweep?: boolean;
}

export async function quoteToken(
  token: `0x${string}`,
  direction: QuoteDirection,
  amountIn: bigint,
  client: ChainReader = undefined as any,
  quoteAssets?: readonly string[],
  options: QuoteSearchOptions = {},
): Promise<TokenQuote> {
  throw new NotImplementedInPublicBuild("lib/dex/quote.ts#quoteToken");
}
