// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { isAddress, parseAbi } from "viem";

import { quoteToken } from "../dex/quote";

import type { PoolRef } from "../dex/types";

import type { ChainReader } from "../rpc/client";

import { resolveSimEnv } from "../dex/sim-env";

import { readSwapConfig } from "./config";

import { swapClient } from "./read-client";

import { readEmptiedPools, type EmptiedPool } from "./emptied-pools";

import { ROBINHOOD_CHAIN_ID, robinhoodChain } from "../config/chain";

import { discoverMultihopRoutes, type MultihopDiscoveryResult } from "./multihop-discovery";

import { quoteMultihopRoutes } from "./multihop-quote";

import {
  DEADLINE_SECONDS,
  isQuoteAsset,
  lower,
  matchesPayAsset,
  MAX_SLIPPAGE_BPS,
  wrapped,
  type AllowanceClient,
  type Candidate,
  USDG,
  type PlanDeps as ContextPlanDeps,
} from "./plan-context";

import { checkTradeEligibility, type TradeEligibility } from "./eligibility";

import { readVerdictSignal } from "./verdict-signal";

import { forkMode as realForkMode, forkBannerSentence, forkModeBlocksTrading } from "./fork-mode";

import { planViaSushi } from "./plan-sushi";

import { planViaUniversalRouter } from "./plan-ur";

import { planViaPath } from "./plan-path";

import { graphPathCandidates, graphSkipsSummary, routePoolsKey, serverEthCall } from "./graph-candidates";

import { quoteRoutes, type QuoteLeg } from "./route-quote";

import { toQuoteLeg } from "./route-quote-targets";

import { fetchSushiQuote, type SushiQuote } from "./sushi";

import { readTokenDisplayPair } from "./token-display";

import { profileForDex, UNISWAP_UR, UNISWAP_V4_POOL_MANAGER, WETH } from "./venues";

import {
  NATIVE,
  type Address,
  type AlternativeQuote,
  type ExcludedVenue,
  type PlanView,
  type SwapPlanDiagnostic,
  type SwapPlanResponse,
  type SwapRequest,
} from "./types";

import { readRwaTokenByAddress } from "../data/registry";

import { readTradeSecuritySignal, type TradeSecurityOptions, type TradeSecuritySignal } from "./trade-security";

import { assessHookForSwap, computeV4PoolId } from "./hook-admission";

import { PONS_V2_REVIEWED_HOOK } from "./reviewed-hooks";

import { DUST_USD, quoteCatalogueV4Routes, type V3PoolCandidate } from "./v4-routes";

import { autoSlippageBps } from "./auto-slippage";

import { resolvePoolHints } from "./pool-hint-resolution";

import { parseSwapPoolHints } from "./pool-hints";

import { deepestListedPool, highPoolFeeBps, MAIN_PRICE_GAP_BPS, routeAdvice, routeKeyOf, stickyWeight, withPoolFee } from "./route-advice";

import type { V4PoolKey } from "./ur-plan";

import { resolveStockBridges } from "./stock-bridges";

import { estimateQuoteSizeImpact } from "./price-impact";

import { quote as quoteV4Pool } from "../dex/v4-sim";

import { quoteSingleHop } from "./multihop-quote";

import { latestVerdictRowForToken } from "../data/ledger";

import type { VerdictSignalDeps } from "./verdict-signal";

import { factCache } from "./fact-cache";

import { runSharedRpcWork } from "../observability/context";

export interface PlanDeps extends ContextPlanDeps {
  verdictDeps?: VerdictSignalDeps;
  isCanonicalRwa?: (address: string) => boolean | Promise<boolean>;
  readRwaPaused?: (address: `0x${string}`, client: NonNullable<ContextPlanDeps["client"]>) => Promise<boolean>;
  onDiagnostic?: (diagnostic: SwapPlanDiagnostic) => void;
  readSecuritySignal?: (token: string, options?: TradeSecurityOptions) => Promise<TradeSecuritySignal>;
  graphCandidates?: typeof graphPathCandidates;
  resolvePoolHints?: typeof resolvePoolHints;
  /** What Uniswap V4's PoolManager holds of `token`; throws when the read fails. */
  readPoolManagerBalance?: (token: Address) => Promise<bigint>;
}

export async function buildSwapPlan(req: SwapRequest, deps: PlanDeps = undefined as any, onDiagnostic?: (diagnostic: SwapPlanDiagnostic) => void): Promise<SwapPlanResponse> {
  throw new NotImplementedInPublicBuild("lib/swap/plan.ts#buildSwapPlan");
}