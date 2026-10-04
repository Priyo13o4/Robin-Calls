// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { decodeFunctionData, encodeFunctionData, parseAbi } from "viem";

import { assertPublicHttpsUrl } from "../security/ssrf";

import { SUSHI_ROUTE_PROCESSOR } from "./venues";

import { NATIVE, type Address, type Hex } from "./types";

export const SUSHI_EXECUTOR = "0x0e867974275cd31c25015c2753c9d75f9f355379";

export interface SushiQuoteInput {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  /** Sender and recipient. The simulation later runs as this address. */
  account: Address;
  slippageBps: number;
  feeBps: number;
  feeRecipient: Address;
  /**
   * Which leg pays our fee. A buy must pay on the input (ETH or USDG): output mode would pay
   * us in the memecoin, which §7 rules out (L183).
   */
  feeBy: "input" | "output";
}

export type SushiQuote =
  | {
      kind: "ok";
      tx: { to: Address; data: Hex; value: bigint };
      /** The API's figure, net of our fee on the input side and gross of it on the output side. */
      quotedOut: bigint;
      /** The floor the transaction itself enforces, measured on the recipient's balance. */
      amountOutMin: bigint;
      feeAmount: bigint;
      priceImpactBps: number | null;
      /** ERC20 inputs are approved to RedSnwapper itself, not to a Permit2. */
      approvalSpender: Address | null;
      executor: Address;
      /** The leg the route actually pays our fee on, decoded from the calldata. */
      feeSide: "input" | "output";
    }
  /** Sushi has no route for this pair. A fact about the pair. */
  | { kind: "no-route"; detail: string }
  /** We could not reach or read the API. NOT a fact about the pair (§4). */
  | { kind: "unavailable"; detail: string }
  /** The API answered with something we will not put in front of a wallet. */
  | { kind: "rejected"; detail: string };

export function sushiUrl(input: SushiQuoteInput): string {
  throw new NotImplementedInPublicBuild("lib/swap/sushi.ts#sushiUrl");
}

export function verifySushiResponse(body: unknown, input: SushiQuoteInput): SushiQuote {
  throw new NotImplementedInPublicBuild("lib/swap/sushi.ts#verifySushiResponse");
}

export function withAmountOutMin(data: Hex, minOut: bigint): Hex {
  throw new NotImplementedInPublicBuild("lib/swap/sushi.ts#withAmountOutMin");
}

export async function fetchSushiQuote(input: SushiQuoteInput, deps: { fetchImpl?: typeof fetch } = undefined as any): Promise<SushiQuote> {
  throw new NotImplementedInPublicBuild("lib/swap/sushi.ts#fetchSushiQuote");
}