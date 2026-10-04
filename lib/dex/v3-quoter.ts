// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { ChainReader } from "../rpc/client";

export type V3QuoteOutcome =
  | { kind: "OUT"; amountOut: bigint; gasEstimate: bigint }
  | { kind: "REVERT"; detail: string }
  | { kind: "FAULT"; detail: string };

export async function quoteV3ExactInputSingle(
  _client: ChainReader,
  _quoter: `0x${string}`,
  _tokenIn: `0x${string}`,
  _tokenOut: `0x${string}`,
  _amountIn: bigint,
  _fee: number,
): Promise<V3QuoteOutcome> {
  throw new NotImplementedInPublicBuild("lib/dex/v3-quoter.ts#quoteV3ExactInputSingle");
}

export const decodeQuoterV2Result = (_data: `0x${string}`) => {
  throw new NotImplementedInPublicBuild("lib/dex/v3-quoter.ts#decodeQuoterV2Result");
};

export const encodeQuoterV2Call = (_args: {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  fee: number;
  sqrtPriceLimitX96: bigint;
}) => {
  throw new NotImplementedInPublicBuild("lib/dex/v3-quoter.ts#encodeQuoterV2Call");
};
