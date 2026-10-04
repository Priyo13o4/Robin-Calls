// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { decodeErrorResult, encodeFunctionData, parseAbi } from "viem";

import { resolveSimEnv, type SimEnv } from "../dex/sim-env";

import { robinhoodChain } from "../config/chain";

import { swapClient } from "./read-client";

import { NATIVE, SIM_MAX_FEE_MULTIPLIER, SWAP_GAS_LIMIT, type Address, type Hex } from "./types";

export interface WatchedBalance {
  /** NATIVE (0x0) reads ETH through Multicall3. */
  token: Address;
  holder: Address;
}

export interface BalanceDelta {
  token: Address;
  holder: Address;
  before: bigint;
  after: bigint;
  delta: bigint;
}

export interface SimulateSwapInput {
  account: Address;
  tx: { to: Address; data: Hex; value: bigint };
  watch: WatchedBalance[];
  gasLimit?: bigint;
  /** Optional common head when all plan probes need the same chain state. */
  blockNumber?: bigint;
  /** Request-shared gas environment avoids refetching for each candidate. */
  gasPrice?: bigint;
  /** Approvals sent in the same EIP-5792 batch, run before the first balance read. */
  preCalls?: SimulateSwapInput["tx"][];
}

export type SimulateSwapResult =
  | { kind: "ok"; gasUsed: bigint; gasPrice: bigint; deltas: BalanceDelta[] }
  /** The chain answered no. Evidence about the plan. */
  | { kind: "reverted"; revertData: Hex; reason: string }
  /** The wallet cannot fund value plus gas. About the wallet, never about the route. */
  | { kind: "unfunded"; reason: string }
  /** We could not look. NEVER evidence, and never a reason to offer the trade anyway. */
  | { kind: "fault"; detail: string; /** The node never answered; anything else is our probe. */ transient?: true };

type SimCall = { status: "success" | "failure"; data: Hex; gasUsed: bigint };

type SimBlock = { calls: SimCall[]; baseFeePerGas?: string | bigint | number | null };

export interface SimulateClient {
  simulateBlocks(args: Record<string, unknown>): Promise<SimBlock[]>;
}

export interface SimulateDeps {
  client?: SimulateClient;
  simEnv?: () => Promise<SimEnv>;
}

export async function simulateSwap(input: SimulateSwapInput, deps: SimulateDeps = undefined as any): Promise<SimulateSwapResult> {
  throw new NotImplementedInPublicBuild("lib/swap/simulate.ts#simulateSwap");
}

export function nativeDeltaExcludingGas(d: BalanceDelta, account: Address, gasUsed: bigint, gasPrice: bigint): bigint {
  throw new NotImplementedInPublicBuild("lib/swap/simulate.ts#nativeDeltaExcludingGas");
}

export interface RoundTripInput {
  account: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  reverseAmount: bigint;
  forward: SimulateSwapInput["tx"];
  reverse: SimulateSwapInput["tx"];
  /** Ephemeral ERC20/Permit2 approvals, executed only inside the simulation. */
  reverseApprovals: SimulateSwapInput["tx"][];
  router: Address;
  routerTokens: Address[];
  /** Use the same chain head as quote/final simulation when available. */
  blockNumber?: bigint;
  /** Reuse the request-scoped gas price to avoid one more RPC per hook candidate. */
  gasPrice?: bigint;
  /** The buy's own batched approvals (EIP-5792), run before anything is measured. */
  preCalls?: SimulateSwapInput["tx"][];
  /** Wall-clock seconds of the quote; the sell-back block is set SELL_BACK_DELAY_SECONDS after it. */
  nowSeconds?: number;
}

export const SELL_BACK_DELAY_SECONDS = 300;

export type RoundTripResult =
  | { kind: "ok"; acquired: bigint; recovered: bigint; lossBps: number }
  | { kind: "reverted"; reason: string }
  | { kind: "fault"; detail: string; /** The node never answered; anything else is our probe. */ transient?: true };

export async function simulateRoundTrip(input: RoundTripInput, deps: SimulateDeps = undefined as any): Promise<RoundTripResult> {
  throw new NotImplementedInPublicBuild("lib/swap/simulate.ts#simulateRoundTrip");
}