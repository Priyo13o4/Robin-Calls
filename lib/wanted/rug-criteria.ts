// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { RUG_CRITERIA_VERSION } from "../config/flags";

export type RugEvidenceSource =
  | "market:liquidity-history"
  | "monitor:slow-rug-watch"
  | "scanner:honeypot"
  | "scanner:lp_custody"
  | "scanner:deployer_pulled_liquidity";

export interface RugIndependentEvidence {
  deployer: string;
  tokenAddress: string;
  /** peak liquidity the pool ever reached, USD */
  peakLiquidityUsd: number;
  /** liquidity now, USD */
  currentLiquidityUsd: number;
}

export interface RugScannerDerivedEvidence {
  /** liquidity-removal txs by the deployer (or LP owner) */
  liquidityPulls: { txHash: string; block: number; method: string }[];
  /**
   * Did the pull probe actually RUN, and what did it conclude?
   *
   * `liquidityPulls: []` used to carry two incompatible meanings — "we checked
   * the chain and the deployer never pulled" and "no scan has looked yet" — and
   * Criterion C read the second as the first. That published a real rug under a
   * false story: PDT ($0x01ae6bec…) was assembled from a verdict taken 40
   * minutes BEFORE the pull, so its bundle said "no single pull, a gradual
   * drain" about a wallet that added liquidity at 09:55 and removed it in one
   * `removeLiquidityETHSupportingFeeOnTransferTokens` at 10:38.
   *
   * This is CLAUDE.md §4's third state, made explicit: an empty array is not a
   * finding. `unavailable` must never be spoken as `none`.
   */
  pullProbe?: "found" | "none" | "unavailable";
  /** true if the LP was not locked/renounced at the time of the pull */
  lpWasControlled: boolean;
  /** honeypot verdict from the scanner, if any */
  honeypotConfirmed?: boolean;
  /**
   * A honeypot CRITICAL that was reached by a scan which ALSO read live
   * liquidity in the same pass — the only evidence that licenses a past-tense
   * sentence about the trading window.
   *
   * Without it, criterion B said *"buyers could not sell while liquidity was
   * present"* for $BLKFUEL off a scan taken 28 minutes AFTER the pool was
   * drained. 159 sells worth 26.49 WETH had executed while it was liquid, and
   * our own `market_snapshots` recorded 158 of them. The probe was right about
   * the present and was published as a claim about a past it never observed
   * (KNOWN-PROBLEMS L16).
   *
   * Not §4 — nothing was empty. It is the time axis: a measurement at T spoken
   * as a fact about T−3h. Ask of any past-tense clause: **what pins the reading
   * to the window it describes?**
   */
  honeypotObservedWhileLiquid?: boolean;
  /**
   * The slow-rug monitor observed liquidity bleed from its trailing peak.
   *
   * Sourced from `slow_rug_watch`, not from a verdict, so it is the one field
   * here that is not scanner-derived. It stays in this interface because no
   * criterion indicts on it (criterion C never indicts), so moving it would
   * imply an independent path that does not exist.
   *
   *
   * Named `drainObserved`, not `gradualDrainConfirmed`, because that is all the
   * producer can honestly assert: it sets this for EVERY `slow_rug_watch` row,
   * and a row is created by any drain — including one caused by a single pull.
   * Whether the drain was *gradual* is a separate question that only
   * `pullProbe` can answer.
   */
  drainObserved?: boolean;
}

export type RugEvidenceInput = RugIndependentEvidence & RugScannerDerivedEvidence;

export interface RugMatch {
  isRug: boolean;
  criteriaVersion: string;
  /**
   * What the FIRING criteria actually consumed. Empty when `isRug` is false,
   * because a non-indictment makes no claim to validate anything against.
   *
   * This is the field that unblocks backtesting (L118). Read it as an exclusion
   * list: a label naming `scanner:honeypot` may measure any check except the
   * honeypot one.
   */
  evidenceSources: RugEvidenceSource[];
  /**
   * Value the deployer took from victims or denied them, USD. Two components,
   * which never overlap: liquidity already pulled out, plus — for a confirmed
   * honeypot — the liquidity still sitting in the pool that buyers provably
   * cannot sell back out of. Trapped funds are harm: a honeypot that hasn't
   * cashed out yet has still taken the money, and scoring it $0 would have let
   * the most complete traps look like the most harmless ones.
   */
  extractedUsd: number;
  reasons: string[];
  evidence: Record<string, unknown>;
}

export function evaluateRug(input: RugEvidenceInput): RugMatch {
  throw new NotImplementedInPublicBuild("lib/wanted/rug-criteria.ts#evaluateRug");
}