import { createHash } from "crypto";
import type { TokenMark, Verdict } from "../types";

/**
 * Result fingerprint (PRD §8.6) — the deterministic identity of a scan
 * outcome. Two scans with the same fingerprint say the same thing about the
 * token, so the second must not mint a new ledger receipt (REUSE).
 *
 * Includes: formula + receipt-policy versions, token, score/tier/critical,
 * ordered check ids/statuses/deductions, active permanent-mark state, and the
 * selected pool. Liquidity is deliberately EXCLUDED — it enters the receipt
 * decision only through the §8.3 threshold comparison, never the fingerprint
 * (a bucketed copy here would double-count and flap across bucket edges).
 *
 * Request noise (sim wallets, request ids, timestamps, latency) never enters.
 */

export const RECEIPT_POLICY_VERSION = "1";

export function fingerprintVerdict(verdict: Verdict, marks: TokenMark[]): string {
  const canonical = JSON.stringify({
    formulaVersion: verdict.scoreVersion,
    receiptPolicyVersion: RECEIPT_POLICY_VERSION,
    tokenAddress: verdict.tokenAddress.toLowerCase(),
    score: verdict.score,
    tier: verdict.tier,
    criticalOverride: verdict.criticalOverride,
    checks: verdict.checks.map((c) => ({
      id: c.id,
      status: c.status,
      deduction: c.deduction,
    })),
    activeMarks: marks
      .filter((m) => m.liftedAt === null)
      .map((m) => m.kind)
      .sort(),
    selectedPool: verdict.market?.poolAddress?.toLowerCase() ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export interface ReceiptDecisionInput {
  fingerprint: string;
  /** Latest canonical state for the token, or null when none exists. */
  previous: {
    fingerprint: string | null;
    createdAt: string;
    liquidityUsd: number | null;
  } | null;
  currentLiquidityUsd: number | null;
  nowMs: number;
  canonicalMaxAgeSeconds: number;
  materialLiquidityChangePct: number;
}

export interface ReceiptDecision {
  action: "APPEND" | "REUSE";
  /** Machine-readable §8.3 conditions that forced an APPEND (empty for REUSE). */
  reasons: string[];
}

/** §8.3/§8.4 — append on any material change, otherwise reuse the receipt. */
export function decideReceipt(input: ReceiptDecisionInput): ReceiptDecision {
  const reasons: string[] = [];
  const prev = input.previous;

  if (!prev) reasons.push("no-previous-receipt");
  else {
    if (prev.fingerprint === null) reasons.push("previous-has-no-fingerprint");
    else if (prev.fingerprint !== input.fingerprint) reasons.push("fingerprint-changed");

    const ageSeconds = (input.nowMs - Date.parse(prev.createdAt)) / 1000;
    if (ageSeconds > input.canonicalMaxAgeSeconds) reasons.push("archival-interval-elapsed");

    if (
      prev.liquidityUsd !== null &&
      prev.liquidityUsd > 0 &&
      input.currentLiquidityUsd !== null
    ) {
      const deltaPct =
        (Math.abs(input.currentLiquidityUsd - prev.liquidityUsd) / prev.liquidityUsd) * 100;
      if (deltaPct >= input.materialLiquidityChangePct) reasons.push("material-liquidity-change");
    } else if ((prev.liquidityUsd === null) !== (input.currentLiquidityUsd === null)) {
      reasons.push("liquidity-availability-changed");
    }
  }

  return reasons.length > 0 ? { action: "APPEND", reasons } : { action: "REUSE", reasons: [] };
}
