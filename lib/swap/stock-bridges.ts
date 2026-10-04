// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { isAddress } from "viem";

import type { Address } from "./types";

import { NATIVE } from "./types";

import { WETH } from "./venues";

import { USDG } from "./plan-context";

import type { PoolRef } from "../dex/types";

import { readRwaRegistryTokens } from "../data/registry";

import { isDatabaseConfigured } from "../db/client";

export interface ResolveStockBridgesInput {
  tokenIn: Address;
  tokenOut: Address;
  endpointPools: {
    tokenIn: readonly PoolRef[];
    tokenOut: readonly PoolRef[];
  };
}

export interface ResolveStockBridgesDeps {
  readRwaRegistryTokens?: () => Promise<Array<{
    address: string;
    asset_name: string;
    asset_symbol: string;
    category: string;
    verify_status: string;
  }>>;
}

export interface ResolveStockBridgesResult {
  bridges: Address[];
  complete: boolean;
  unsearched: string[];
}

export async function resolveStockBridges(input: ResolveStockBridgesInput, deps: ResolveStockBridgesDeps = undefined as any): Promise<ResolveStockBridgesResult> {
  throw new NotImplementedInPublicBuild("lib/swap/stock-bridges.ts#resolveStockBridges");
}