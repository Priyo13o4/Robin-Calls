// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { LaunchFeedRow } from "./feed-types";

import { readEquityReference } from "../market/equity-reference";

import { readRwaQuotes } from "../market/rwa-quotes";

import { isStockToken } from "../trade/types";

import { CANONICAL_STOCK_TOKENS } from "../trade/canonical-stocks";

export async function resolveLaunchQuotePrices(rows: readonly LaunchFeedRow[]): Promise<Record<string, number>> {
  throw new NotImplementedInPublicBuild("lib/launches/quote-prices.ts#resolveLaunchQuotePrices");
}