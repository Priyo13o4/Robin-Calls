import { formatUnits } from "viem";
import type { PlanView, RouteAdvice, SwapPlanResponse, SimulationView, TokenDisplay, TokenIndictmentFacts } from "./types";

/**
 * Significant digits a row prints; the unrounded value travels in `exact`. Eight so a
 * six-decimal dollar token prints in full rather than losing its last cent digit.
 */
const AMOUNT_SIG_DIGITS = 8;

export interface AmountLabel {
  /** What the row prints, symbol included when we have one. */
  text: string;
  /** The full-precision figure when `text` dropped digits, else null. */
  exact: string | null;
  /** True when the token's decimals did not read, so `text` is base units. */
  unscaled: boolean;
}

/**
 * Cut to `sig` significant digits by TRUNCATION, never rounding. This formats a floor
 * (`minOut`) as well as an estimate, and rounding a floor up would print a guarantee
 * larger than the one the transaction enforces.
 */
function truncateSignificant(decimal: string, sig: number): { text: string; cut: boolean } {
  const [intPart, fracPart = ""] = decimal.split(".");
  const keep =
    intPart !== "0"
      ? Math.max(0, sig - intPart.length)
      : (fracPart.match(/^0*/)?.[0].length ?? 0) + sig;
  const kept = fracPart.slice(0, keep).replace(/0+$/, "");
  const text = kept ? `${intPart}.${kept}` : intPart;
  return { text, cut: Number(text) !== Number(decimal) };
}

/**
 * A base-unit string as a person reads it. `decimals: null` is a READ FAILURE, so the
 * amount stays in base units and says so rather than being scaled by an assumed 18:
 * the wrong scale is the one bug here that looks exactly like a correct answer (§4).
 */
export function formatAmount(base: string, display: TokenDisplay): AmountLabel {
  const suffix = display.symbol ? ` ${display.symbol}` : "";
  if (display.decimals === null) {
    return { text: `${base} base units${suffix}`, exact: null, unscaled: true };
  }
  let full: string;
  try {
    full = formatUnits(BigInt(base), display.decimals);
  } catch {
    return { text: `${base} base units${suffix}`, exact: null, unscaled: true };
  }
  const { text, cut } = truncateSignificant(full, AMOUNT_SIG_DIGITS);
  return { text: `${text}${suffix}`, exact: cut ? `${full}${suffix}` : null, unscaled: false };
}

/** One plain sentence per advice kind; no pool ids, the reader is deciding whether to trade. */
export function adviceSentence(advice: RouteAdvice): string {
  const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
  if (advice.kind === "unrouted-counterparty") {
    const depth = advice.liquidityUsd !== null ? ` ($${Math.round(advice.liquidityUsd).toLocaleString("en-US")} listed)` : "";
    return `This token's main pool${depth} trades it against another token (${short(advice.via)}). Swaps here only go through ETH, USDG or a listed stock token, so that pool was not used.`;
  }
  if (advice.kind === "pool-unloaded") {
    const depth = advice.liquidityUsd !== null ? ` ($${Math.round(advice.liquidityUsd).toLocaleString("en-US")} listed)` : "";
    return `This token's main pool${depth} did not load just now, so this quote may not be its best price. Try again in a minute.`;
  }
  return "Trading against USDG can reach the largest listed pool. We have not compared its price.";
}

/**
 * The subject's deepest pool reads empty on chain. `seen` comes from the page's own feed and
 * dates the removal only when that feed saw one on this very pool.
 */
export function emptiedSentence(
  emptied: NonNullable<Extract<SwapPlanResponse, { status: "no-route" }>["emptied"]>,
  seen?: { poolId: string; atMs: number | null } | null,
): string {
  const main = emptied[0];
  const listed = main.listedLiquidityUsd !== null && main.listedLiquidityUsd >= 1
    ? `, even though $${Math.round(main.listedLiquidityUsd).toLocaleString("en-US")} is still listed for it`
    : "";
  const when = seen && seen.atMs !== null && seen.poolId === main.pool.toLowerCase()
    ? ` Its liquidity was removed at ${new Date(seen.atMs).toISOString().slice(11, 16)} UTC.`
    : "";
  const many = emptied.length > 1 ? ` ${emptied.length - 1} other pool${emptied.length === 2 ? "" : "s"} for it read empty too.` : "";
  return `This token's main pool has no liquidity left${listed}, so it cannot be bought or sold there.${when}${many}`;
}

// Pure status mapper for swap plan responses with an exhaustiveness check.
export function describePlanStatus(res: SwapPlanResponse, seenRemoval?: { poolId: string; atMs: number | null } | null): {
  tone: "neutral" | "warn" | "danger";
  sentence: string | null;
} {
  switch (res.status) {
    case "disabled":
      return { tone: "warn", sentence: res.detail || "Trading is switched off right now." };
    case "fee-unconfigured":
      return { tone: "warn", sentence: "Trading is unavailable right now." };
    case "config-unavailable":
      return { tone: "warn", sentence: "Could not prepare this trade. Try again." };
    case "invalid":
      return { tone: "danger", sentence: res.detail };
    case "unsupported-pair":
      return { tone: "warn", sentence: "This pair is not supported yet." };
    case "no-route": {
      if (res.emptied?.length) return { tone: "danger", sentence: `No route found. ${emptiedSentence(res.emptied, seenRemoval)}` };
      const advice = res.advice?.[0];
      if (advice) return { tone: "warn", sentence: `No route found. ${adviceSentence(advice)}` };
      return { tone: "neutral", sentence: "No route is available for this trade right now." };
    }
    case "quote-unavailable": {
      switch (res.reason) {
        case "rate-limited":
          return { tone: "warn", sentence: "Too many requests. Please wait a moment and try again." };
        case "transport":
          return { tone: "warn", sentence: "We couldn't check this trade just now. Try again in a moment." };
        case "simulation-failed":
          return { tone: "warn", sentence: "This route failed its test run on chain. Try again in a moment." };
        case "every-route-reverted":
          return { tone: "warn", sentence: "This token looks like it is refusing this trade. It failed the test run on every pool we tried, which usually means the token blocks this wallet or blocks selling. Nothing was spent." };
        case "unverified":
          return { tone: "warn", sentence: "We couldn't confirm this trade in a test run, so we are not offering it." };
        case "amount-too-small":
          return { tone: "warn", sentence: "This amount is too small to trade. Try a larger amount." };
        default:
          return { tone: "warn", sentence: "Could not get a quote. Try again." };
      }
    }
    case "ready":
      return { tone: "neutral", sentence: null };
    default: {
      const _exhaustive: never = res;
      return _exhaustive;
    }
  }
}

const PLAN_STATUSES: ReadonlySet<string> = new Set<SwapPlanResponse["status"]>([
  "disabled", "fee-unconfigured", "config-unavailable", "invalid", "unsupported-pair", "no-route", "quote-unavailable", "ready",
]);

/** A body without one of our statuses (a 429 from the rate limiter, a proxy page) is "could not load", never blank. */
export function planResponseFromHttp(httpStatus: number, body: unknown): SwapPlanResponse {
  const status = body && typeof body === "object" ? (body as { status?: unknown }).status : undefined;
  if (typeof status === "string" && PLAN_STATUSES.has(status)) return body as SwapPlanResponse;
  if (httpStatus === 429) {
    return {
      status: "quote-unavailable",
      detail: "The price service answered 429.",
      reason: "rate-limited",
    };
  }
  return {
    status: "quote-unavailable",
    detail: `The price service answered ${httpStatus}.`,
    reason: "transport",
  };
}

/**
 * `expiresAt` is server time; the gate and the refresh timer run on the browser's clock. Shift
 * it by the skew the response's `x-server-time` header reveals, or a fast clock sees every plan
 * as expired and refetches until rate limited.
 *
 * When the clock cannot be reconciled (missing/malformed server time header, non-finite or
 * non-positive timestamps), the ready plan is made unusable by zeroing `expiresAt` (e.g. expiresAt=0)
 * so skewed or unsynchronized clients fail closed rather than executing an expired plan.
 */
export function toLocalClock(res: SwapPlanResponse, serverTimeHeader: string | null, localNowMs: number): SwapPlanResponse {
  if (res.status !== "ready") return res;
  const planObj = res.plan && typeof res.plan === "object" ? res.plan : ({} as PlanView);
  if (!res.plan || typeof res.plan !== "object") {
    return { ...res, plan: { ...planObj, expiresAt: 0 } };
  }
  const rawExpiresAt = res.plan.expiresAt;
  const isExpiresAtValid = typeof rawExpiresAt === "number" && Number.isFinite(rawExpiresAt) && rawExpiresAt > 0;
  const isLocalNowValid = typeof localNowMs === "number" && Number.isFinite(localNowMs) && localNowMs > 0;

  if (!serverTimeHeader || serverTimeHeader.trim() === "" || !isExpiresAtValid || !isLocalNowValid) {
    return { ...res, plan: { ...res.plan, expiresAt: 0 } };
  }

  const serverNow = Number(serverTimeHeader);
  if (!Number.isFinite(serverNow) || serverNow <= 0) {
    return { ...res, plan: { ...res.plan, expiresAt: 0 } };
  }

  const rebased = rawExpiresAt - serverNow + localNowMs;
  const finalExpiresAt = Number.isFinite(rebased) && rebased > 0 ? rebased : 0;
  return { ...res, plan: { ...res.plan, expiresAt: finalExpiresAt } };
}

// Maps simulation outcomes to user-facing explanations or null if execution can proceed.
export function describeSimulation(sim: SimulationView): string | null {
  switch (sim.status) {
    case "ok":
      return null;
    case "pending-approval":
      return "Approve first. We check the exact trade before you sign it.";
    case "reverted":
      return `This trade would fail right now: ${sim.reason}`;
    case "unavailable":
      return sim.transient
        ? "We could not check this trade on chain, so we will not offer it. Try again."
        : "We couldn't confirm this trade in a test run, so we will not offer it.";
    case "residue":
      return "This route would leave funds behind in the router, so we will not offer it.";
    case "insufficient-balance":
      return sim.detail;
    default: {
      const _exhaustive: never = sim;
      return _exhaustive;
    }
  }
}

export type SlippageSetting = number | "auto";

/**
 * Whether a served plan was built with the tolerance the control currently shows.
 *
 * Auto happens to land on the same 50 bps a user can pick by hand, so the number alone cannot
 * answer this; `slippageMode` is what the plan carries the request back in.
 */
export function planMatchesSlippage(setting: SlippageSetting, plan: PlanView): boolean {
  if (setting === "auto") return plan.slippageMode === "auto";
  return plan.slippageMode === "manual" && plan.slippageBps === setting;
}

export interface StepGateInput {
  res: SwapPlanResponse;
  connected: boolean;
  wrongChain: boolean;
  now: number;
  /**
   * What the form holds RIGHT NOW, parsed from the raw input rather than the debounced one.
   * Null when it does not parse to a positive amount. A plan for anything else must not fire.
   */
  inputs: { tokenIn: string; tokenOut: string; amountIn: string; slippageBps: SlippageSetting } | null;
  /** A wallet prompt, a receipt wait or a refetch is running; a second click resends the same tx. */
  busy: boolean;
}

/**
 * Whether the panel's action button may fire.
 *
 * The simulation gates the SWAP and nothing else. lib/swap/plan.ts cannot simulate a swap
 * whose approval or Permit2 signature is still outstanding, so it reports `pending-approval`
 * and omits the swap step. Requiring "ok" for every step therefore leaves an ERC20 trade
 * with a button that can never be pressed, and the approval that would clear it can never
 * be sent. A swap step still requires a measured "ok", which is the rule that matters.
 */
export function canExecuteStep(input: StepGateInput): boolean {
  const { res, connected, wrongChain, now, inputs, busy } = input;
  if (busy || res.status !== "ready") return false;
  if (!connected || wrongChain) return false;
  if (
    typeof now !== "number" ||
    !Number.isFinite(now) ||
    now <= 0 ||
    !res.plan ||
    typeof res.plan !== "object"
  ) {
    return false;
  }

  // Expiration validation: reject absent, non-numeric, NaN, Infinity, non-positive, or expired plan
  const expiresAt = res.plan.expiresAt;
  if (
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= 0 ||
    now >= expiresAt
  ) {
    return false;
  }

  // Deadline validation: reject absent, non-numeric, NaN, Infinity, non-positive, or passed deadline
  const deadline = res.plan.deadline;
  if (
    typeof deadline !== "number" ||
    !Number.isFinite(deadline) ||
    deadline <= 0
  ) {
    return false;
  }
  const deadlineMs = deadline > 1e11 ? deadline : deadline * 1000;
  if (now >= deadlineMs) {
    return false;
  }

  // The plan is fetched after a debounce and a round trip, so for a moment it describes the
  // PREVIOUS amount or token. Pressing then would sign a trade the screen no longer shows.
  if (
    !inputs ||
    typeof res.plan.tokenIn !== "string" ||
    typeof res.plan.tokenOut !== "string" ||
    inputs.amountIn !== res.plan.amountIn ||
    inputs.tokenIn.toLowerCase() !== res.plan.tokenIn.toLowerCase() ||
    inputs.tokenOut.toLowerCase() !== res.plan.tokenOut.toLowerCase() ||
    // Same window one field along: the control changes instantly, the plan built with the old
    // tolerance is still on screen until the refetch lands. Signing it would enforce a minimum
    // the user did not pick, and the loosening direction is silent.
    !planMatchesSlippage(inputs.slippageBps, res.plan)
  ) {
    return false;
  }
  const step = Array.isArray(res.plan.steps) ? res.plan.steps[0] : undefined;
  if (!step) return false;
  if (step.kind === "swap" || step.kind === "batch") return res.plan.simulation?.status === "ok";
  return true;
}

/**
 * What we know about a token's verdict at the point of trade. `unscanned` and `unknown` are
 * different facts: one says we never looked, the other says we could not read what we have.
 * Neither is a clean verdict (§4), so neither may render as one.
 */
export type VerdictSignal =
  | { kind: "verdict"; tier: string; symbol?: string | null }
  | { kind: "unscanned" }
  | { kind: "unknown" };

export interface TradeWarning {
  level: "none" | "caution" | "danger";
  sentence: string | null;
}

/**
 * The sentence shown beside every Trade button. Only a CLEAR verdict shows nothing. An
 * unrecognised tier warns rather than passes: a list of dangerous tiers that goes stale fails
 * toward an all-clear, a list of safe ones fails toward a warning (§8 #16).
 */
export function tradeWarning(signal: VerdictSignal): TradeWarning {
  if (signal.kind === "unscanned") {
    return { level: "caution", sentence: "We have not scanned this token. Check it before you trade." };
  }
  if (signal.kind === "unknown") {
    return { level: "caution", sentence: "We could not load this token's verdict. Check it before you trade." };
  }
  switch (signal.tier) {
    case "CLEAR":
      return { level: "none", sentence: null };
    case "CAUTION":
      return { level: "caution", sentence: "Our scan found risks on this token. Read the verdict before you trade." };
    case "DANGER":
    case "CRITICAL":
      return {
        level: "danger",
        sentence: `Our scan rated this token ${signal.tier}. Read the verdict before you trade.`,
      };
    default:
      return { level: "caution", sentence: "We could not read this token's rating. Check the verdict before you trade." };
  }
}

/**
 * A response body to a cross-check answer. Anything that is not one of our three shapes is
 * "we could not look": a 429 from the rate limiter, an nginx page, a truncated body. The one
 * thing it may never become is `clear`, which is the all-clear §8 #9 published off a read that
 * never ran.
 */
/**
 * Whether a set of facts amounts to nothing against this token. Every counted quantity must be
 * zero AND we must actually hold the token: a new field defaults to counting, not to ignored.
 * Shared by the reader and by the browser's parse of the same body, so they cannot disagree.
 */
export function isClear(facts: TokenIndictmentFacts): boolean {
  return (
    facts.tokenKnown &&
    facts.tokenRugs === 0 &&
    facts.activeMarkKinds.length === 0 &&
    facts.deployerOtherRugs === 0
  );
}
