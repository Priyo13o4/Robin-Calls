// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { quoteToken, VenueQuote } from "../dex/quote";

import type { readSwapConfig } from "./config";

import type { swapClient } from "./read-client";

import type { simulateSwap, simulateRoundTrip } from "./simulate";

import type { forkMode } from "./fork-mode";

import type { fetchSushiQuote } from "./sushi";

import { WETH, type UniversalRouterProfile } from "./venues";

import { NATIVE, type Address, type ExcludedVenue, type SignedPermit, type TokenDisplayPair } from "./types";

export const USDG = {} as any;

export const DEADLINE_SECONDS = 20 * 60;

export const QUOTE_TTL_MS = 45_000;

export const AUTO_SLIPPAGE_BPS = 50;

export const MAX_SLIPPAGE_BPS = 5_000;

export const PERMIT_EXPIRY_SECONDS = 30 * 24 * 60 * 60;

export const lower = (a: string): any => {
  throw new NotImplementedInPublicBuild("lib/swap/plan-context.ts#lower");
};

export function isQuoteAsset(token: Address): boolean {
  throw new NotImplementedInPublicBuild("lib/swap/plan-context.ts#isQuoteAsset");
}

export function wrapped(token: Address): Address {
  throw new NotImplementedInPublicBuild("lib/swap/plan-context.ts#wrapped");
}

export function matchesPayAsset(quote: VenueQuote, asset: Address): boolean {
  throw new NotImplementedInPublicBuild("lib/swap/plan-context.ts#matchesPayAsset");
}

import type { discoverMultihopRoutes } from "./multihop-discovery";

import type { quoteMultihopRoutes } from "./multihop-quote";

import type { checkTradeEligibility } from "./eligibility";

import type { assessHookForSwap } from "./hook-admission";

export type AllowanceClient = Pick<ReturnType<typeof swapClient>, "readContract">;

export interface PlanDeps {
  quote?: typeof quoteToken;
  readSpendBalance?: (client: AllowanceClient, account: Address, token: Address) => Promise<bigint | null>;
  forkMode?: typeof forkMode;
  sushi?: typeof fetchSushiQuote;
  simulate?: typeof simulateSwap;
  roundTrip?: typeof simulateRoundTrip;
  executionSnapshot?: () => Promise<{ blockNumber: bigint; gasPrice: bigint }>;
  config?: typeof readSwapConfig;
  client?: AllowanceClient;
  now?: () => number;
  checkEligibility?: typeof checkTradeEligibility;
  assessHook?: typeof assessHookForSwap;
  readHookFeeBps?: (hook: `0x${string}`) => Promise<number | null>;
  enableMultihop?: boolean;
  multihopDiscovery?: typeof discoverMultihopRoutes;
  multihopQuote?: typeof quoteMultihopRoutes;
  v4Routes?: typeof import("./v4-routes").quoteCatalogueV4Routes;
  quoteV3?: (pool: import("../dex/types").PoolRef, tokenIn: Address, tokenOut: Address, amountIn: bigint) => Promise<bigint>;
  readRwaRegistryTokens?: typeof import("../data/registry").readRwaRegistryTokens;
  readVerdictSignal?: typeof import("./verdict-signal").readVerdictSignal;
  resolveStockBridges?: typeof import("./stock-bridges").resolveStockBridges;
  quoteHop?: typeof import("./multihop-quote").quoteSingleHop;
  /** The 1% reference quote for a hookless V4 route's price impact. */
  quoteV4Pool?: typeof import("../dex/v4-sim").quote;
  readEmptiedPools?: typeof import("./emptied-pools").readEmptiedPools;
}

import type { V4PoolKey } from "./ur-plan";

export interface MultihopCandidateInfo {
  bridge: Address;
  leg1Pool: Address;
  leg2Pool: Address;
  leg1Protocol?: "v2" | "v3" | "v4";
  leg2Protocol?: "v2" | "v3" | "v4";
  leg1FeeTier?: number;
  leg2FeeTier?: number;
  leg1V4Key?: V4PoolKey;
  leg2V4Key?: V4PoolKey;
}

export interface Candidate {
  quote: VenueQuote;
  profile: UniversalRouterProfile;
  protocol: "v2" | "v3" | "v4";
  v4Key?: V4PoolKey;
  /** Set only after the hook and exact pool identity pass admission. */
  approvedHookPoolKey?: V4PoolKey;
  approvedHookPoolKeys?: readonly V4PoolKey[];
  v4Path?: readonly V4PoolKey[];
  hookFeeBps?: number;
  multihop?: MultihopCandidateInfo;
  /** A route-graph route of 1 to 3 pools, built by lib/swap/path-plan.ts (plan-path.ts). */
  path?: { legs: readonly import("./path-plan").PathLeg[] };
}

export interface PlanContext {
  deps: PlanDeps;
  client: AllowanceClient;
  approvals?: ReturnType<typeof import("./plan-approvals").createApprovalReader>;
  account: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  /** Null means Auto. */
  slippageBps: number | null;
  /** What Auto resolves to for this request (lib/swap/auto-slippage.ts). */
  autoSlippageBps?: number;
  feeRecipient: Address;
  feeBps: number;
  nowMs: number;
  nowSeconds: number;
  deadline: bigint;
  permit: SignedPermit | null;
  /** EIP-5792 wallet: approvals become calls in the swap's batch instead of steps. */
  atomicBatch: boolean;
  /** Buying a token with no saved scan: test that it sells straight back (L205). Never blocks on a fault. */
  sellTest?: boolean;
  /** Set when the wallet holds less than amountIn: every test run is skipped (it could only fail). */
  unfunded?: string;
  searchComplete: boolean;
  candidates: Candidate[];
  excluded: ExcludedVenue[];
  /** Read once per plan so both venue branches print the same scale. */
  display: TokenDisplayPair;
  approvedExtraBridges?: readonly Address[];
}