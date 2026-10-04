import type { ProviderState } from "../market/provider";

/**
 * Completeness assessment (PRD §8.5, §10.5, §11.9) — decides whether a fresh
 * pipeline gathered enough defensible evidence to mint a canonical receipt.
 *
 * The rule is deliberately narrow: only an INFRASTRUCTURE failure of a
 * scoring-required provider degrades a scan. A domain outcome such as
 * NOT_FOUND (no pool) is a complete, receipt-worthy verdict — a dead token
 * with no liquidity is a legitimate thing to record. A provider timeout or
 * rate-limit is not: scoring it would risk a fabricated FAIL/PASS off missing
 * data (§11.9), so the fresh attempt is `partial` and never appends.
 */

export type Completeness = "complete" | "partial";

export type DegradedReason =
  | "history-incomplete"
  | "rate-limited"
  | "timeout"
  | "unavailable"
  | "invalid-response";

export interface DegradedAttempt {
  attemptedAt: string;
  failedProvider: string;
  reason: DegradedReason;
  detail?: string;
}

export interface HistoryIncompleteDetail {
  poolCount: number;
  detail: string;
  followUp: "queued";
}

/** User-facing copy that keeps pool-history gaps distinct from provider faults. */
export function degradedScanMessage(input: {
  degradedAttempt?: DegradedAttempt;
  historyIncomplete?: HistoryIncompleteDetail;
}): string {
  if (input.historyIncomplete) {
    const marketFailure = input.degradedAttempt?.failedProvider.startsWith("market:")
      ? `Live market data is temporarily unavailable (${input.degradedAttempt.reason}). `
      : "";
    const count = input.historyIncomplete.poolCount;
    return `${marketFailure}Pool-flow history coverage is incomplete: ${input.historyIncomplete.detail} A bounded background follow-up for ${count} material pool${count === 1 ? " is" : "s is"} queued.`;
  }
  return `Live market data is temporarily unavailable${input.degradedAttempt ? ` (${input.degradedAttempt.reason})` : ""}.`;
}

export interface CompletenessAssessment {
  completeness: Completeness;
  /** Present only when partial: which provider degraded and why. */
  degraded: DegradedAttempt | null;
}

/** Infrastructure states map to a degraded reason; domain states do not. */
const INFRA_FAILURE: Partial<Record<ProviderState, DegradedReason>> = {
  RATE_LIMITED: "rate-limited",
  TIMEOUT: "timeout",
  ERROR: "unavailable",
  INVALID_CONFIGURATION: "unavailable",
};

/**
 * Assess completeness from the scan-market provider's normalized state.
 * `attemptedAtIso` stamps the degraded refresh so the client can show both the
 * stale verdict time and the failed-refresh time (§18.3).
 */
export function assessMarketCompleteness(
  marketState: ProviderState,
  providerId: string,
  attemptedAtIso: string
): CompletenessAssessment {
  const reason = INFRA_FAILURE[marketState];
  if (reason) {
    return {
      completeness: "partial",
      degraded: {
        attemptedAt: attemptedAtIso,
        failedProvider: `market:${providerId}`,
        reason,
      },
    };
  }
  return { completeness: "complete", degraded: null };
}
