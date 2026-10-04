// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { Hex } from "viem";

import { quoteLegFrom, quoteRoutes, quoteRpcParams, type EthCall, type QuoteLeg } from "@/lib/swap/route-quote";

import type { RoutesResponse } from "@/lib/swap/routes-api";

export const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";

export interface ExitDeps {
  fetchRoutes?: (token: string, signal: AbortSignal) => Promise<RoutesResponse | null>;
  call?: EthCall;
}

export function publicEthCall(signal?: AbortSignal, sleep: any = undefined as any): EthCall {
  throw new NotImplementedInPublicBuild("lib/trade/holder-exit.ts#publicEthCall");
}

export async function holderExitUsd(token: string, balances: readonly bigint[], ethUsd: number | null, signal: AbortSignal, deps: ExitDeps = undefined as any, primaryPool?: string | null): Promise<(number | null)[] | null> {
  throw new NotImplementedInPublicBuild("lib/trade/holder-exit.ts#holderExitUsd");
}