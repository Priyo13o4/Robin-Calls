/**
 * The swap plan contract between the plan route (app/api/swap/plan) and the
 * trade UI. Docs: docs/cross-dex-router/WAYS-OF-WORK.md §3 (D8a: direct to each
 * family's router, no contract), §4 principles, KNOWN-PROBLEMS L181/L182.
 *
 * Every non-"ready" status is a distinct fact the UI must render as its own
 * sentence. A disabled feature, an unset fee wallet, an incomplete search and
 * "no pool exists" are four different things (CLAUDE.md §4).
 */

import type { SwapPoolHint } from "./pool-hints";

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

/** Native ETH on either leg. Matches lib/dex/registry.ts and the executor. */
export const NATIVE: Address = "0x0000000000000000000000000000000000000000";

/**
 * One gas budget shared by the test run and the Max button: a validated simulation must be
 * able to fund gas * maxFee, so a Max that reserves less fails its own test run (MEME, 2026-09-29).
 */
export const SWAP_GAS_LIMIT = 2_000_000n;
/** simulateSwap sends maxFeePerGas = gasPrice * this. */
export const SIM_MAX_FEE_MULTIPLIER = 2n;

export type SwapFamily = "uniswap" | "pancake" | "sushi";

/** A concrete execution router, one per family deployment. */
export type SwapVenue = "uniswap-ur" | "pancake-infinity-ur" | "pancake-v3-ur" | "sushi-redsnwapper";

export interface SwapRequest {
  /** The connected wallet. Simulation runs AS this address, never a sim wallet. */
  account: Address;
  /** NATIVE for ETH. One leg must be a quote asset: single-hop only for now. */
  tokenIn: Address;
  tokenOut: Address;
  /** Base units, decimal string. */
  amountIn: string;
  /** D5: user-selectable, "auto" derives it from the measured simulated fill. */
  slippageBps: number | "auto";
  /** Present on the second request, after the wallet signed the Permit2 step. */
  permit?: SignedPermit;
  /** Untrusted browser pool suggestions; the server revalidates factory or V4 identity. */
  poolHints?: SwapPoolHint[];
  /** The wallet runs calls atomically (EIP-5792), so approvals ride in one batch with the swap. */
  atomicBatch?: boolean;
  /** The route the client was last served (`PlanView.routeKey`). Only ever picks among candidates. */
  preferRoute?: string;
}

/** A signed Permit2 PermitSingle, echoed back so the plan can embed PERMIT2_PERMIT. */
export interface SignedPermit {
  token: Address;
  spender: Address;
  amount: string;
  expiration: number;
  nonce: number;
  sigDeadline: string;
  signature: Hex;
}

export interface TxRequest {
  to: Address;
  data: Hex;
  /** Wei, decimal string. */
  value: string;
  chainId: number;
}

/** A venue we did not use, and why. Every exclusion is an all-clear unless it says why (§8 #13). */
export interface ExcludedVenue {
  venue: string;
  pool: Address | null;
  reason: string;
  /**
   * L184 — this venue was never searched (switched off here), as opposed to
   * searched and ruled out. The two need different sentences: "try again"
   * is false advice when nothing about waiting will turn the venue on.
   */
  notSearched?: boolean;
}

/** Why the route does not use the token's deepest listed pool (L213). */
export type RouteAdvice =
  /** DexScreener lists it, our lookup faulted: "could not look", never "no pool". */
  | { kind: "pool-unloaded"; pool: Address; liquidityUsd: number | null }
  /** Its counter-token trades against USDG, so paying (or receiving) USDG reaches it in two pools. */
  | { kind: "use-usdg"; via: Address; pool: Address; liquidityUsd: number | null }
  /** Its deepest listed pool trades against a token the router does not use as a bridge. */
  | { kind: "unrouted-counterparty"; via: Address; pool: Address; liquidityUsd: number | null };

export interface AlternativeQuote {
  venue: SwapVenue;
  pool: Address | null;
  /**
   * L193 — a V4 `pool` is the PoolManager singleton, identical for every V4
   * pool, so three alternatives came back as three copies of one address. This
   * is the one that says which pool it is.
   */
  poolId?: Address;
  amountOut: string;
}

export type PlanStep =
  /** ERC20 approve. `spender` is Permit2 for the Universal Routers, the router itself for Sushi. */
  | { kind: "approve"; token: Address; spender: Address; amount: string; tx: TxRequest }
  /** EIP-712 Permit2 PermitSingle to sign; resend the request with `permit` set. */
  | { kind: "permit2-sign"; typedData: Permit2TypedData }
  /** The swap itself. Only ever present when simulation.status === "ok". */
  | { kind: "swap"; tx: TxRequest }
  /** Approvals then the swap, sent as one atomic EIP-5792 batch and simulated as that sequence. Only when simulation.status === "ok". */
  | { kind: "batch"; calls: TxRequest[] };

export interface Permit2TypedData {
  domain: { name: "Permit2"; chainId: number; verifyingContract: Address };
  types: {
    PermitDetails: { name: string; type: string }[];
    PermitSingle: { name: string; type: string }[];
  };
  primaryType: "PermitSingle";
  message: {
    details: { token: Address; amount: string; expiration: number; nonce: number };
    spender: Address;
    sigDeadline: string;
  };
}

export type SimulationView =
  /** The exact served transaction ran as the user, and nothing was left in the router. */
  | { status: "ok"; measuredOut: string; feePaid: string; gasUsed: string }
  /** Nothing to simulate until the approval or signature step is done. */
  | { status: "pending-approval" }
  /** The chain answered no. `reason` is a plain sentence. */
  | { status: "reverted"; reason: string }
  /** We could not establish the result. `transient`: the node did not answer. Never offer a swap on this. */
  | { status: "unavailable"; detail: string; transient?: true }
  /** L182: the simulated plan left a balance in the router. Never offer it. */
  | { status: "residue"; detail: string }
  /** The wallet holds less than this trade spends, so nothing was simulated. The price still stands. */
  | { status: "insufficient-balance"; detail: string };

/**
 * How to PRINT one leg's amounts. Read from the token on every plan, never assumed:
 * the panel used to render base units, and a hardcoded 18 would have rendered a
 * confident wrong number instead (§8 #11).
 */
export interface TokenDisplay {
  symbol: string | null;
  /** null = the read failed. The panel then shows base units and says why (§4). */
  decimals: number | null;
}

export interface TokenDisplayPair {
  in: TokenDisplay;
  out: TokenDisplay;
}

export interface PlanView {
  venue: SwapVenue;
  family: SwapFamily;
  /** Always travels with tokenIn/tokenOut: a bare pool does not say which side it is about (§8 #21). */
  pool: Address | null;
  /** V4 pool identity; `pool` is only the shared PoolManager singleton. */
  poolId?: Address;
  protocol: "v2" | "v3" | "v4" | "aggregator";
  feeTier: number | null;
  tokenIn: Address;
  tokenOut: Address;
  /** Symbol and decimals for the two legs, so a rendered amount is the amount. */
  tokenInDisplay: TokenDisplay;
  tokenOutDisplay: TokenDisplay;
  amountIn: string;
  feeBps: number;
  feeAmount: string;
  feeAsset: Address;
  feeRecipient: Address;
  /** Quoter figure net of our fee. An estimate; `simulation.measuredOut` is the measurement. */
  quotedOut: string;
  /** Enforced on chain by the plan's own minimum checks. */
  minOut: string;
  /** The tolerance this plan was actually built with, in basis points. */
  slippageBps: number;
  /**
   * Whether `slippageBps` came from the user or from Auto. Auto happens to sit at the same
   * 50 bps a user can pick by hand, so the number alone cannot say which was requested, and
   * the panel's gate has to compare the plan against the control (§8 #11: pass the fact).
   */
  slippageMode: "auto" | "manual";
  priceImpactBps: number | null;
  /** Set when a hop charges more than 1%: what the pool fees take, already folded into priceImpactBps. */
  poolFeeBps?: number;
  advice?: RouteAdvice[];
  /** Echoed back as `preferRoute` so the next quote keeps this route unless another is clearly better. */
  routeKey?: string;
  /**
   * The token's deepest listed pool is not in this route and a sell through it is known to fail:
   * from the current scan's blocked routes, or from this request's own sell test. Absent = no such
   * evidence, never "the main pool is fine".
   */
  mainPoolSell?: { pool: string; liquidityUsd: number | null; source: "scan" | "test"; reason: string };
  /**
   * The served route does not use the token's deepest listed pool and yields at least 3% fewer
   * tokens for the same input amount. Folded into priceImpactBps to trigger acknowledgement.
   */
  mainPoolPrice?: { pool: string; liquidityUsd: number | null; shortfallBps: number };
  /** False when any venue's read faulted: never present this as the best price (principle 3). */
  searchComplete: boolean;
  alternatives: AlternativeQuote[];
  excluded: ExcludedVenue[];
  /** Unix seconds, fixed per D5. */
  deadline: number;
  /** Epoch ms after which the UI must re-request before signing. */
  expiresAt: number;
  steps: PlanStep[];
  simulation: SimulationView;
  /** Current-state buy/sell evidence for selected hooked pools; not a future exit guarantee. */
  hookRoundTrip?: {
    status: "measured" | "warning" | "unavailable";
    acquired?: string;
    recovered?: string;
    lossBps?: number;
    detail?: string;
  };
  /** True when the token has not been scanned yet — the UI should prompt a security scan. */
  unscanned?: boolean;
  /** The unscanned token's address, so the UI can link to /scan/[address]. */
  unscannedToken?: Address;
  /** Truthful route metadata including ordered tokens, pool IDs, fee tiers for direct or multihop */
  route?: RouteMetadata;
  /** Set when the served route came from the pool graph (plan-path.ts). Absent = discovery. */
  routeSource?: "graph";
}

export interface RouteHopMetadata {
  pool: Address | null;
  protocol: "v2" | "v3" | "v4";
  feeTier: number | null;
  /** V4 hook, when the selected pool has one. Address identity alone is not approval. */
  hookAddress?: Address | null;
  /** Additional hook charge in basis points when its verified fee is known. */
  hookFeeBps?: number | null;
  /** Explicitly distinguishes an unknown charge from a known zero-fee hook. */
  hookFeeStatus?: "known" | "dynamic" | "unknown";
  tokenIn: Address;
  tokenOut: Address;
}

export interface RouteMetadata {
  routeType: "direct" | "multihop";
  bridge?: Address;
  /** Ordered token path: e.g. [tokenIn, tokenOut] for direct or [tokenIn, bridge, tokenOut] for multihop */
  tokens: Address[];
  /** Ordered pool IDs or addresses */
  pools: (Address | null)[];
  /** Fee tiers per hop */
  feeTiers: (number | null)[];
  /** Detailed hop metadata */
  hops: RouteHopMetadata[];
}

export type QuoteUnavailableReason =
  | "simulation-failed"
  /** Two or more different pools all reverted: the token or wallet, not a route, is refusing. */
  | "every-route-reverted"
  | "rate-limited"
  | "price-service"
  | "transport"
  /** Our test run could not confirm the route (not a network fault). */
  | "unverified"
  /** Our fee on this amount rounds to zero, so no trade can settle it. */
  | "amount-too-small";

export type SwapPlanDiagnosticStage =
  | "validation"
  | "config"
  | "compliance"
  | "eligibility"
  | "quote"
  | "routing"
  | "simulation"
  | "approval"
  | "ready";

export interface SwapPlanDiagnostic {
  stage: SwapPlanDiagnosticStage;
  code: string;
  metadata?: Record<string, unknown>;
}

export type SwapPlanResponse =
  | { status: "disabled"; detail: string; requestId?: string }
  | { status: "fee-unconfigured"; detail: string; requestId?: string }
  | { status: "config-unavailable"; requestId?: string }
  | { status: "invalid"; detail: string; requestId?: string }
  | { status: "unsupported-pair"; detail: string; requestId?: string }
  /** `searchComplete: false` means we could not look everywhere, not that nothing exists. */
  | {
      status: "no-route"; searchComplete: boolean; excluded: ExcludedVenue[]; advice?: RouteAdvice[]; requestId?: string;
      /** The subject's pools that read empty on chain now, deepest listed first. Absent = none confirmed. */
      emptied?: import("./emptied-pools").EmptiedPool[];
    }
  | { status: "quote-unavailable"; detail: string; reason?: QuoteUnavailableReason; requestId?: string }
  | { status: "ready"; plan: PlanView; requestId?: string };


/**
 * The Wanted-board cross-check at the point of sign. This is the wire shape of
 * GET /api/wanted/token/[address] as well as the reader's return, so there is one contract
 * rather than a server shape and a client copy that drift.
 */
export interface TokenIndictmentFacts {
  /**
   * Whether we hold this token at all. Zeroes from a token we have no row for mean "we have
   * nothing on file", which is not the same claim as "we checked and it is clean" (§8 #9).
   */
  tokenKnown: boolean;
  /** Confirmed rugs recorded against THIS token. */
  tokenRugs: number;
  /** Open marks against this token, by kind. A lifted mark is not an accusation. */
  activeMarkKinds: string[];
  /** The wallet that launched it, when we hold one. */
  deployer: string | null;
  /**
   * Tokens this token's deployer LAUNCHED that carry a rug, excluding this one. Both halves
   * are load-bearing: counted off `tokens.deployer_id` rather than `rugs.deployer_id` so the
   * sentence's claim of launch authorship is the thing measured, and with this token removed
   * so a count of one cannot be the token itself (§9, and §8 #12 for the subject).
   */
  deployerOtherRugs: number;
}

/**
 * Three states, and `unknown` is the whole point. §8 #9 is this exact surface: a read that
 * could not run returned its documented empty value, the caller tested it for truthiness, and
 * the product published "no honeypot or pump-dump marks stand against this token."
 */
export type TradeIndictment =
  | { kind: "unknown" }
  | { kind: "clear" }
  | { kind: "indicted"; facts: TokenIndictmentFacts };
