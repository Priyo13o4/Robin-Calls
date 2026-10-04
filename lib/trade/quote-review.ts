/**
 * Truthful quote review helpers, material change detection, taxed output disclosure,
 * exact base-unit formatting, and safe token DTO serialization.
 *
 * Implements Audit 2026-09-21 findings:
 * - A01: Disclosure of taxed output tokens and distinction between router gross minOut
 *   and net recipient amount.
 * - A02: Safe BigInt DTO serialization for localStorage and unproven Max gas reserve elimination.
 * - A03: Truthful review of actual PlanView quotes, material change detection, and
 *   enforcement that first action transitions to review and never broadcasts.
 */

import { formatUnits, parseUnits } from "viem";
import { SIM_MAX_FEE_MULTIPLIER, SWAP_GAS_LIMIT, type PlanView, type PlanStep, type SimulationView, type Address } from "../swap/types";
import type { SelectableToken } from "./types";

export interface PlanReviewComparison {
  materiallyChanged: boolean;
  /** Every difference, for logs. Not for the user: fee wei and calldata change on every tick. */
  reasons: string[];
  /** The one plain sentence to stop on, or null when the fresh plan can proceed silently. */
  interrupt: string | null;
}

/**
 * Computes a deterministic string fingerprint of a PlanView's economic terms.
 * If market movement changes venue, pool, amounts, fees, minOut, or slippage,
 * the fingerprint changes.
 */
export function computePlanFingerprint(plan: PlanView): string {
  const measuredOut =
    plan.simulation.status === "ok" ? plan.simulation.measuredOut : plan.quotedOut;

  const stepKinds = plan.steps.map((s) => s.kind).join(",");

  return [
    plan.venue,
    (plan.pool ?? "").toLowerCase(),
    plan.amountIn,
    plan.feeBps.toString(),
    plan.feeAmount,
    (plan.feeAsset ?? "").toLowerCase(),
    plan.minOut,
    measuredOut,
    plan.slippageBps.toString(),
    plan.protocol,
    stepKinds,
  ].join("|");
}

export interface ComparePlansOptions {
  /**
   * When true, allow step array to change if it represents normal progression
   * (e.g. after approval or permit signature) while verifying the final swap terms
   * and economic parameters have not drifted.
   */
  allowStepProgression?: boolean;
}

/**
 * Compares a previously reviewed plan against a fresh plan to detect material changes.
 * Material changes include:
 * - Venue or protocol change
 * - Pool address change
 * - Input amount change
 * - Fee (bps, amount, or asset) change
 * - Minimum output (minOut) change
 * - Measured output (simulation ok) or quoted output change
 * - Slippage tolerance change
 * - Step kinds or target transactions change (unless allowed step progression)
 */
export function comparePlansForReview(
  reviewed: PlanView,
  fresh: PlanView,
  options: ComparePlansOptions = {}
): PlanReviewComparison {
  const reasons: string[] = [];

  if (reviewed.venue !== fresh.venue) {
    reasons.push(`Venue changed from ${reviewed.venue} to ${fresh.venue}`);
  }

  const reviewedPool = (reviewed.pool ?? "").toLowerCase();
  const freshPool = (fresh.pool ?? "").toLowerCase();
  if (reviewedPool !== freshPool) {
    reasons.push(`Pool changed from ${reviewedPool || "none"} to ${freshPool || "none"}`);
  }

  if (reviewed.amountIn !== fresh.amountIn) {
    reasons.push(`Input amount changed from ${reviewed.amountIn} to ${fresh.amountIn}`);
  }

  if (reviewed.feeBps !== fresh.feeBps) {
    reasons.push(`Fee bps changed from ${reviewed.feeBps} to ${fresh.feeBps}`);
  }

  if (reviewed.feeAmount !== fresh.feeAmount) {
    reasons.push(`Fee amount changed from ${reviewed.feeAmount} to ${fresh.feeAmount}`);
  }

  const reviewedFeeAsset = (reviewed.feeAsset ?? "").toLowerCase();
  const freshFeeAsset = (fresh.feeAsset ?? "").toLowerCase();
  if (reviewedFeeAsset !== freshFeeAsset) {
    reasons.push(`Fee asset changed from ${reviewedFeeAsset} to ${freshFeeAsset}`);
  }

  if (reviewed.minOut !== fresh.minOut) {
    reasons.push(`Minimum output changed from ${reviewed.minOut} to ${fresh.minOut}`);
  }

  if (reviewed.slippageBps !== fresh.slippageBps) {
    reasons.push(`Slippage changed from ${reviewed.slippageBps} bps to ${fresh.slippageBps} bps`);
  }

  // Check measured or quoted output
  if (reviewed.simulation.status === "ok" && fresh.simulation.status === "ok") {
    if (reviewed.simulation.measuredOut !== fresh.simulation.measuredOut) {
      reasons.push(
        `Measured output changed from ${reviewed.simulation.measuredOut} to ${fresh.simulation.measuredOut}`
      );
    }
  } else if (reviewed.simulation.status !== fresh.simulation.status) {
    reasons.push(
      `Simulation status changed from ${reviewed.simulation.status} to ${fresh.simulation.status}`
    );
  } else {
    // Both not simulation ok; compare quotedOut
    if (reviewed.quotedOut !== fresh.quotedOut) {
      reasons.push(`Quoted output changed from ${reviewed.quotedOut} to ${fresh.quotedOut}`);
    }
  }

  // Check steps & transaction requests
  if (!options.allowStepProgression) {
    if (reviewed.steps.length !== fresh.steps.length) {
      reasons.push(`Step count changed from ${reviewed.steps.length} to ${fresh.steps.length}`);
    } else {
      for (let i = 0; i < reviewed.steps.length; i++) {
        const rStep = reviewed.steps[i];
        const fStep = fresh.steps[i];
        if (rStep.kind !== fStep.kind) {
          reasons.push(`Step ${i + 1} kind changed from ${rStep.kind} to ${fStep.kind}`);
          break;
        }
        if (rStep.kind === "approve" && fStep.kind === "approve") {
          if (
            rStep.token.toLowerCase() !== fStep.token.toLowerCase() ||
            rStep.spender.toLowerCase() !== fStep.spender.toLowerCase() ||
            rStep.amount !== fStep.amount
          ) {
            reasons.push(`Approval step ${i + 1} parameters changed`);
            break;
          }
        } else if (rStep.kind === "swap" && fStep.kind === "swap") {
          if (
            rStep.tx.to.toLowerCase() !== fStep.tx.to.toLowerCase() ||
            rStep.tx.data !== fStep.tx.data ||
            rStep.tx.value !== fStep.tx.value
          ) {
            reasons.push(`Swap transaction execution changed`);
            break;
          }
        } else if (rStep.kind === "batch" && fStep.kind === "batch") {
          const same = rStep.calls.length === fStep.calls.length && rStep.calls.every((c, j) =>
            c.to.toLowerCase() === fStep.calls[j].to.toLowerCase() && c.data === fStep.calls[j].data && c.value === fStep.calls[j].value);
          if (!same) {
            reasons.push(`Swap transaction execution changed`);
            break;
          }
        }
      }
    }
  } else {
    // During progression (e.g. approve -> swap), verify that the swap step matches reviewed terms
    const reviewedSwap = reviewed.steps.find((s) => s.kind === "swap");
    const freshSwap = fresh.steps.find((s) => s.kind === "swap");
    if (reviewedSwap && freshSwap) {
      if (reviewedSwap.tx.to.toLowerCase() !== freshSwap.tx.to.toLowerCase()) {
        reasons.push(`Swap destination router changed`);
      }
      if (reviewedSwap.tx.value !== freshSwap.tx.value) {
        reasons.push(`Swap value changed`);
      }
    }
  }

  const interrupt = interruptFor(reviewed, fresh, options);
  return { materiallyChanged: interrupt !== null, reasons, interrupt };
}

const expectedOut = (p: PlanView) => BigInt(p.simulation.status === "ok" ? p.simulation.measuredOut : p.quotedOut);
const routeOf = (p: PlanView) => [p.venue, p.protocol, p.poolId ?? p.pool ?? "", ...(p.route?.pools ?? [])].join("|").toLowerCase();

/**
 * L213 #7: a sell's fee is taken from output, so "Fee amount changed from 9645663046554" fired on
 * nearly every re-quote. Stop only for a different trade or a worse price than the user accepted.
 */
function interruptFor(reviewed: PlanView, fresh: PlanView, options: ComparePlansOptions): string | null {
  if (routeOf(reviewed) !== routeOf(fresh)) return "The route changed. Review the new route and confirm again.";
  if (reviewed.amountIn !== fresh.amountIn || reviewed.feeBps !== fresh.feeBps ||
      (reviewed.feeAsset ?? "").toLowerCase() !== (fresh.feeAsset ?? "").toLowerCase() ||
      reviewed.slippageBps !== fresh.slippageBps) {
    return "The trade terms changed. Review them and confirm again.";
  }
  const reviewedSwap = reviewed.steps.find((s) => s.kind === "swap");
  const freshSwap = fresh.steps.find((s) => s.kind === "swap");
  if (reviewedSwap && freshSwap && (reviewedSwap.tx.to.toLowerCase() !== freshSwap.tx.to.toLowerCase() || reviewedSwap.tx.value !== freshSwap.tx.value)) {
    return "The trade terms changed. Review them and confirm again.";
  }
  if (!options.allowStepProgression && reviewed.steps.map((x) => x.kind).join() !== fresh.steps.map((x) => x.kind).join()) {
    return "This trade now needs a different wallet step. Review it and confirm again.";
  }
  if (!options.allowStepProgression && reviewed.simulation.status === "ok" && fresh.simulation.status !== "ok") {
    return "The new quote could not be tested. Review it and confirm again.";
  }
  const was = expectedOut(reviewed);
  const now = expectedOut(fresh);
  const dropBps = was > 0n && now < was ? Number(((was - now) * 10_000n) / was) : 0;
  if (now < BigInt(reviewed.minOut) || dropBps * 2 > reviewed.slippageBps) {
    const d = fresh.tokenOutDisplay;
    const amount = (v: bigint) => formatBaseUnits(v, d.decimals, 6);
    return `The price moved. You now get about ${amount(now)} ${d.symbol ?? "tokens"}, down from ${amount(was)}. Review and confirm again.`;
  }
  return null;
}

export interface TaxDisclosureResult {
  isTaxApplicable: boolean;
  recipientAmountLabel: string;
  minOutLabel: string;
  disclosureText: string;
  warningText?: string;
}

/**
 * Returns truthful disclosure text for taxed output tokens vs native output.
 * Implements A01: simulated recipient amount is an estimate, and minOut is router gross
 * (checked before the final transfer), so recipient net can fall below displayed minOut.
 */
export function getTaxDisclosure(params: {
  isNative?: boolean;
  tokenSymbol?: string;
  tokenAddress?: string;
}): TaxDisclosureResult {
  if (params.isNative) {
    return {
      isTaxApplicable: false,
      recipientAmountLabel: "Simulated Net Recipient Output",
      minOutLabel: "Minimum Recipient Output",
      disclosureText:
        "Native ETH output is transferred directly to recipient without token transfer taxes.",
    };
  }

  const symbol = params.tokenSymbol || "token";
  return {
    isTaxApplicable: true,
    recipientAmountLabel: `Simulated ${symbol} Output (Estimate)`,
    minOutLabel: "Router Gross Floor (Pre-tax transfer)",
    disclosureText:
      "Simulated recipient amount is an estimate. Router minimum (minOut) is enforced before final transfer to recipient; recipient net received can fall below the displayed minimum if output transfer taxes change.",
    warningText:
      "The router checks minOut before transferring tokens to your wallet. For taxed or rebase tokens, net received may be lower than minOut; displayed minOut is not a guaranteed net recipient minimum.",
  };
}

/**
 * Formats a SwapVenue and protocol into a human-readable display string.
 */
export function formatVenueDisplay(venue: string, protocol?: string): string {
  let label = venue;
  switch (venue) {
    case "uniswap-ur":
      label = "Uniswap Universal Router";
      break;
    case "pancake-infinity-ur":
      label = "PancakeSwap Infinity Universal Router";
      break;
    case "pancake-v3-ur":
      label = "PancakeSwap V3 Universal Router";
      break;
    case "sushi-redsnwapper":
      label = "Sushi RedSnwapper";
      break;
  }

  if (protocol && protocol !== "aggregator" && !label.toLowerCase().includes(protocol)) {
    return `${label} (${protocol.toUpperCase()})`;
  }
  return label;
}

export interface PriceImpactDisplay {
  hasImpact: boolean;
  formatted: string;
  isKnown: boolean;
}

/**
 * Formats price impact. When backend does not supply a value (null/undefined),
 * truthfully returns isKnown: false and "Unknown" rather than a hardcoded "< 0.1%".
 */
export function formatPriceImpact(impactBps: number | null | undefined): PriceImpactDisplay {
  if (impactBps === null || impactBps === undefined || !Number.isFinite(impactBps)) {
    return {
      hasImpact: false,
      formatted: "Unknown",
      isKnown: false,
    };
  }
  return {
    hasImpact: true,
    formatted: `${(impactBps / 100).toFixed(2)}%`,
    isKnown: true,
  };
}

/**
 * Formats exact base units using token decimals or returns base units when decimals are unavailable.
 */
export function formatBaseUnits(
  rawUnits: string | bigint,
  decimals: number | null | undefined,
  maxFractionDigits: number = 6
): string {
  const unitsBigInt = typeof rawUnits === "bigint" ? rawUnits : BigInt(rawUnits || "0");
  if (decimals === null || decimals === undefined || typeof decimals !== "number" || decimals < 0) {
    return `${unitsBigInt.toString()} (base units)`;
  }
  const formatted = formatUnits(unitsBigInt, decimals);
  const parts = formatted.split(".");
  if (parts.length === 2 && parts[1].length > maxFractionDigits) {
    return `${parts[0]}.${parts[1].slice(0, maxFractionDigits)}`;
  }
  return formatted;
}

export interface ValidateExactRawBalanceParams {
  amount: string;
  decimals: number | null | undefined;
  rawBalance: bigint | null | undefined;
  tokenSymbol?: string;
  isNative?: boolean;
  txValueWei?: bigint;
  measuredGasUsed?: bigint | string;
  gasPriceWei?: bigint | string;
  conservativeReserveWei?: bigint;
  nativeRawBalance?: bigint | null | undefined;
}

export interface ExactRawBalanceValidationResult {
  valid: boolean;
  baseAmountIn?: bigint;
  errorMsg?: string;
  gasReserveWei?: bigint;
  isGasMeasured?: boolean;
}

/**
 * Pure validation seam for exact decimal parsing and authoritative raw balance checking.
 * - Parses canonical decimal string to base-unit BigInt (no IEEE 754 float drift).
 * - Enforces sub-unit precision: rejects amounts exceeding token decimals.
 * - Rejects guessed 18 decimals when token metadata is unknown.
 * - Compares exact BigInt amount against authoritative rawBalance (including 0n and >2^53 units).
 * - Fails closed with a clear wait/refresh message if rawBalance is unavailable (no float fallback).
 * - Enforces that native balance covers tx value plus gas budget (using quote-specific measured budget
 *   when available, or conservative unmeasured reserve; never asserting measured when unmeasured).
 */
export function validateExactRawBalance(
  params: ValidateExactRawBalanceParams
): ExactRawBalanceValidationResult {
  const {
    amount,
    decimals,
    rawBalance,
    tokenSymbol,
    isNative,
    txValueWei,
    measuredGasUsed,
    gasPriceWei,
    conservativeReserveWei,
    nativeRawBalance,
  } = params;

  // 1. Amount string validation
  if (!amount || typeof amount !== "string" || amount.trim() === "") {
    return { valid: false, errorMsg: "Please enter a valid amount." };
  }

  let canonicalAmount = amount.trim();
  if (canonicalAmount.startsWith(".")) {
    canonicalAmount = "0" + canonicalAmount;
  }
  if (canonicalAmount.endsWith(".")) {
    canonicalAmount = canonicalAmount.slice(0, -1);
  }

  if (!/^\d+(\.\d+)?$/.test(canonicalAmount)) {
    return { valid: false, errorMsg: "Please enter a valid positive decimal amount." };
  }

  // 2. Token decimals metadata validation (never guess 18)
  if (
    decimals === null ||
    decimals === undefined ||
    typeof decimals !== "number" ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  ) {
    return {
      valid: false,
      errorMsg: "Token decimals metadata is unavailable. Cannot parse amount safely.",
    };
  }

  // 3. Sub-unit precision check
  const parts = canonicalAmount.split(".");
  if (parts.length > 1 && parts[1].length > decimals) {
    return {
      valid: false,
      errorMsg: `Amount exceeds maximum precision of ${decimals} decimal places.`,
    };
  }

  // 4. Parse canonical decimal amount to base-unit bigint
  let baseAmountIn: bigint;
  try {
    baseAmountIn = parseUnits(canonicalAmount, decimals);
  } catch {
    return {
      valid: false,
      errorMsg: "Invalid amount entered for token decimals.",
    };
  }

  if (baseAmountIn <= 0n) {
    return {
      valid: false,
      errorMsg: "Please enter an amount greater than 0.",
    };
  }

  // 5. Authoritative raw balance validation
  if (rawBalance === undefined || rawBalance === null) {
    return {
      valid: false,
      errorMsg: "Token balance is still loading. Please wait or refresh before submitting.",
    };
  }

  if (typeof rawBalance !== "bigint") {
    return {
      valid: false,
      errorMsg: "Token balance format is invalid. Please wait or refresh.",
    };
  }

  const symbol = tokenSymbol || "token";

  if (rawBalance < baseAmountIn) {
    return {
      valid: false,
      baseAmountIn,
      errorMsg: `Insufficient ${symbol} balance.`,
    };
  }

  // 6. Native balance covering tx value plus gas budget
  let gasBudgetWei = conservativeReserveWei ?? 500_000_000_000_000n; // 0.0005 ETH default
  let isGasMeasured = false;

  if (
    measuredGasUsed !== undefined &&
    gasPriceWei !== undefined &&
    BigInt(measuredGasUsed) > 0n &&
    BigInt(gasPriceWei) > 0n
  ) {
    gasBudgetWei = measuredGasReserveWei(BigInt(measuredGasUsed), BigInt(gasPriceWei));
    isGasMeasured = true;
  }

  if (isNative) {
    const totalRequired = (txValueWei ?? baseAmountIn) + gasBudgetWei;
    if (rawBalance < totalRequired) {
      const formattedGas = formatUnits(gasBudgetWei, 18);
      const label = isGasMeasured ? "measured gas budget" : "conservative gas reserve";
      return {
        valid: false,
        baseAmountIn,
        gasReserveWei: gasBudgetWei,
        isGasMeasured,
        errorMsg: `Insufficient native balance to cover trade amount plus ${label} (${formattedGas} ETH).`,
      };
    }
  } else if (nativeRawBalance !== undefined && nativeRawBalance !== null) {
    const totalRequiredNative = (txValueWei ?? 0n) + gasBudgetWei;
    if (nativeRawBalance < totalRequiredNative) {
      const formattedGas = formatUnits(gasBudgetWei, 18);
      const label = isGasMeasured ? "measured gas budget" : "conservative gas reserve";
      return {
        valid: false,
        baseAmountIn,
        gasReserveWei: gasBudgetWei,
        isGasMeasured,
        errorMsg: `Insufficient native ETH balance to cover transaction ${label} (${formattedGas} ETH).`,
      };
    }
  }

  return {
    valid: true,
    baseAmountIn,
    gasReserveWei: gasBudgetWei,
    isGasMeasured,
  };
}

/**
 * ETH to keep back for gas. Not gasUsed * price: the wallet and our validated test run both
 * need the whole gas LIMIT at the MAX fee. Sized to fund the test run (SWAP_GAS_LIMIT at
 * SIM_MAX_FEE_MULTIPLIER) with 25% for the base fee moving, since eth_gasPrice can read low.
 */
export function measuredGasReserveWei(gasUsed: bigint, gasPrice: bigint): bigint {
  const limit = gasUsed * 2n > SWAP_GAS_LIMIT ? gasUsed * 2n : SWAP_GAS_LIMIT;
  return (limit * gasPrice * SIM_MAX_FEE_MULTIPLIER * 125n) / 100n;
}

export interface MaxNativeResult {
  usableAmountWei: bigint;
  isMeasured: boolean;
  gasReserveWei: bigint;
  status: "measured" | "conservative_estimate" | "insufficient_balance";
  label: string;
  reason?: string;
}

/**
 * Calculates max usable native balance without relying on unproven hardcoded constants
 * represented as measured.
 * If measured gasUsed and gasPrice are available, uses measured budget + buffer.
 * If not available, uses an explicit conservative reserve and clearly marks it as unmeasured.
 */
export function calculateMaxNativeAmount(params: {
  rawBalance: bigint;
  measuredGasUsed?: bigint | string;
  gasPriceWei?: bigint | string;
  conservativeReserveWei?: bigint;
}): MaxNativeResult {
  const rawBalance = params.rawBalance;

  // 1. If measured simulation gasUsed and gasPrice are provided:
  if (
    params.measuredGasUsed !== undefined &&
    params.gasPriceWei !== undefined &&
    BigInt(params.measuredGasUsed) > 0n &&
    BigInt(params.gasPriceWei) > 0n
  ) {
    const measuredReserve = measuredGasReserveWei(BigInt(params.measuredGasUsed), BigInt(params.gasPriceWei));

    if (rawBalance > measuredReserve) {
      return {
        usableAmountWei: rawBalance - measuredReserve,
        isMeasured: true,
        gasReserveWei: measuredReserve,
        status: "measured",
        label: "Measured gas budget applied",
      };
    } else {
      return {
        usableAmountWei: 0n,
        isMeasured: true,
        gasReserveWei: measuredReserve,
        status: "insufficient_balance",
        label: "Insufficient balance for measured gas budget",
        reason: `Balance (${formatUnits(rawBalance, 18)} ETH) is less than measured gas budget (${formatUnits(measuredReserve, 18)} ETH)`,
      };
    }
  }

  // 2. No reliable measured budget: apply conservative explicit reserve
  // Default conservative reserve: 0.0005 ETH (500,000,000,000,000 wei)
  const conservativeReserve = params.conservativeReserveWei ?? 500_000_000_000_000n;

  if (rawBalance > conservativeReserve) {
    return {
      usableAmountWei: rawBalance - conservativeReserve,
      isMeasured: false,
      gasReserveWei: conservativeReserve,
      status: "conservative_estimate",
      label: "Conservative gas reserve (unmeasured, editable)",
      reason: "Gas fee not yet measured via simulation; conservative reserve applied.",
    };
  }

  return {
    usableAmountWei: 0n,
    isMeasured: false,
    gasReserveWei: conservativeReserve,
    status: "insufficient_balance",
    label: "Insufficient balance for gas reserve",
    reason: `Balance (${formatUnits(rawBalance, 18)} ETH) is less than conservative gas reserve (${formatUnits(conservativeReserve, 18)} ETH)`,
  };
}

/**
 * Serializes a SelectableToken into a plain JSON-safe object for localStorage.
 * Converts rawBalance (BigInt) to string to prevent `TypeError: Do not know how to serialize a BigInt`.
 */
export function serializeTokenForStorage(token: SelectableToken): Record<string, unknown> {
  return {
    symbol: token.symbol,
    name: token.name,
    address: token.address,
    decimals: token.decimals,
    priceUsd: token.priceUsd,
    priceEth: token.priceEth,
    balance: token.balance,
    rawBalance: token.rawBalance !== undefined ? token.rawBalance.toString() : undefined,
    volume24h: token.volume24h,
    category: token.category,
    imageUrl: token.imageUrl,
    isNative: token.isNative,
    iconBg: token.iconBg,
    iconColor: token.iconColor,
    iconLabel: token.iconLabel,
  };
}

/**
 * Deserializes a token from localStorage, safely recovering rawBalance as BigInt if present,
 * and ensuring decimals/address are valid.
 */
export function deserializeTokenFromStorage(item: unknown): SelectableToken | null {
  if (!item || typeof item !== "object") return null;
  const t = item as Record<string, unknown>;

  if (typeof t.symbol !== "string" || typeof t.address !== "string") {
    return null;
  }

  // Do not permit guessed 18 decimals when token metadata is missing/unknown
  if (typeof t.decimals !== "number" || !Number.isInteger(t.decimals) || t.decimals < 0) {
    return null;
  }

  let rawBalance: bigint | undefined = undefined;
  if (typeof t.rawBalance === "string" && /^\d+$/.test(t.rawBalance)) {
    try {
      rawBalance = BigInt(t.rawBalance);
    } catch {
      rawBalance = undefined;
    }
  }

  return {
    symbol: t.symbol,
    name: typeof t.name === "string" ? t.name : t.symbol,
    address: t.address,
    decimals: t.decimals,
    priceUsd: typeof t.priceUsd === "number" ? t.priceUsd : 0,
    priceEth: typeof t.priceEth === "number" ? t.priceEth : 0,
    balance: typeof t.balance === "number" ? t.balance : 0,
    rawBalance,
    volume24h: typeof t.volume24h === "number" ? t.volume24h : undefined,
    category:
      t.category === "crypto" || t.category === "stocks" || t.category === "ecosystem"
        ? t.category
        : undefined,
    imageUrl: typeof t.imageUrl === "string" ? t.imageUrl : undefined,
    isNative: Boolean(t.isNative),
    iconBg: typeof t.iconBg === "string" ? t.iconBg : undefined,
    iconColor: typeof t.iconColor === "string" ? t.iconColor : undefined,
    iconLabel: typeof t.iconLabel === "string" ? t.iconLabel : undefined,
  };
}
