// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { decodeFunctionResult, encodeFunctionData, type Hex } from "viem";

import { ROUTE_QUOTE_LENS_ABI, ROUTE_QUOTE_LENS_CODE } from "./route-quote-lens";

export const QUOTE_LENS_ADDRESS = "0x00000000000000000000000000000000000c0de2";

export const QUOTE_LENS_GAS = 50_000_000n;

export const ROUTE_GAS = 6_000_000n;

export const DEEP_ROUTE_GAS = 40_000_000n;

export const LEG_KIND = { v2: 2, v3: 3, v4: 4, clPool: 5 } as const;

export interface QuoteLeg {
  kind: number;
  target: Hex;
  tokenIn: Hex;
  tokenOut: Hex;
  fee: number;
  tickSpacing: number;
  hooks: Hex;
}

export interface LegShape {
  poolId?: string;
  protocol: "v2" | "v3" | "v4";
  dex: string;
  fee: number | null;
  tickSpacing: number | null;
  hooks: string | null;
  tokenIn: string;
  tokenOut: string;
}

export function quoteLegFrom(leg: LegShape, target: string | null): QuoteLeg | null {
  throw new NotImplementedInPublicBuild("lib/swap/route-quote.ts#quoteLegFrom");
}

export const isClPoolLeg = (leg: Pick<LegShape, "dex" | "protocol">): any => {
  throw new NotImplementedInPublicBuild("lib/swap/route-quote.ts#isClPoolLeg");
};

export interface RouteQuote {
  ok: boolean;
  /** amounts[0] = amountIn, amounts[i + 1] = leg i's output. Empty when !ok. */
  amounts: bigint[];
  /** Index of the leg that reverted or returned 0, when !ok and the lens could tell. */
  failedLeg: number | null;
  reason: Hex | null;
  /** We could not price this one: its gas cap ran out, or the call budget never reached it. Unknown, not "no route". */
  outOfGas: boolean;
  gasUsed: number;
}

export type EthCall = (request: { to: Hex; data: Hex; gas: Hex; code: Hex }) => Promise<Hex>;

export function encodeQuoteCall(routes: readonly (readonly QuoteLeg[])[], amountsIn: readonly (readonly bigint[])[], routeGas: bigint = undefined as any): Hex {
  throw new NotImplementedInPublicBuild("lib/swap/route-quote.ts#encodeQuoteCall");
}

export function decodeQuoteResult(data: Hex, counts: readonly number[], routeGas: bigint = undefined as any): (RouteQuote | null)[][] {
  throw new NotImplementedInPublicBuild("lib/swap/route-quote.ts#decodeQuoteResult");
}

export async function quoteRoutes(routes: readonly (readonly QuoteLeg[])[], amountsIn: readonly bigint[], call: EthCall): Promise<RouteQuote[][]> {
  throw new NotImplementedInPublicBuild("lib/swap/route-quote.ts#quoteRoutes");
}

export function quoteRpcParams(request: { to: Hex; data: Hex; gas: Hex; code: Hex }): any {
  throw new NotImplementedInPublicBuild("lib/swap/route-quote.ts#quoteRpcParams");
}