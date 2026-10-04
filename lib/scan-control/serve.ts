import type { Verdict, VerdictRow } from "../types";
import { RECEIPT_POLICY_VERSION } from "../ledger/fingerprint";
import type { DegradedAttempt, HistoryIncompleteDetail } from "../ledger/completeness";
import type { CapacityDenial, ReceiptAction } from "./types";
import { OWN_TOKEN_NOT_SCORED } from "../sale/token";

/**
 * Response-shaping helpers for the scan route (PRD §9.3 headers, §18 scanMeta,
 * §19.4 calm copy). Pure functions — everything here is unit-testable without
 * a request in flight.
 */

/** The full §18.1 scanMeta contract — cache honesty is a product requirement. */
export interface ScanMeta {
  source: "fresh" | "cache" | "database" | "stale-fallback";
  receiptAction: ReceiptAction;
  completeness: "complete" | "partial";
  scannedAt: string;
  ageSeconds: number;
  nextFreshScanAt: string;
  receiptPolicyVersion: string;
  dexProtocols: string[];
  requestId: string;
  providerStates?: Record<string, string>;
  /** Set when a refresh degraded and an older/partial result is served (§18.3). */
  degradedAttempt?: DegradedAttempt;
  historyIncomplete?: HistoryIncompleteDetail;
}

export function buildScanMeta(input: {
  source: ScanMeta["source"];
  receiptAction: ReceiptAction;
  completeness: ScanMeta["completeness"];
  scannedAt: string;
  cooldownSeconds: number;
  requestId: string;
  dexProtocols?: string[];
  receiptPolicyVersion?: string;
  nowMs?: number;
  providerStates?: Record<string, string>;
  degradedAttempt?: DegradedAttempt;
  historyIncomplete?: HistoryIncompleteDetail;
}): ScanMeta {
  const scannedAtMs = Date.parse(input.scannedAt);
  const nowMs = input.nowMs ?? Date.now();
  return {
    source: input.source,
    receiptAction: input.receiptAction,
    completeness: input.completeness,
    scannedAt: input.scannedAt,
    ageSeconds: Math.max(0, Math.floor((nowMs - scannedAtMs) / 1000)),
    nextFreshScanAt: new Date(scannedAtMs + input.cooldownSeconds * 1000).toISOString(),
    receiptPolicyVersion: input.receiptPolicyVersion ?? RECEIPT_POLICY_VERSION,
    dexProtocols: input.dexProtocols ?? [],
    requestId: input.requestId,
    ...(input.providerStates && Object.keys(input.providerStates).length
      ? { providerStates: input.providerStates }
      : {}),
    ...(input.degradedAttempt ? { degradedAttempt: input.degradedAttempt } : {}),
    ...(input.historyIncomplete ? { historyIncomplete: input.historyIncomplete } : {}),
  };
}


/** §9.3 capacity headers. Reveals remaining budget, never other users' traffic. */
export function capacityHeaders(denial: CapacityDenial): Record<string, string> {
  return {
    "Retry-After": String(denial.retryAfterSeconds),
    "X-RateLimit-Scope": denial.scope,
    "X-RateLimit-Limit": String(denial.limit),
    "X-RateLimit-Remaining": String(denial.remaining),
    "X-RateLimit-Reset": String(denial.retryAfterSeconds),
  };
}

/**
 * §19.4 — capacity messages must be specific and calm. The limits themselves
 * are a beta-capacity measure, and the copy says so: users should read them
 * as "early days", not as the product's permanent shape.
 */
export const CAPACITY_COPY: Record<CapacityDenial["scope"], string> = {
  ip: "You have reached the fresh-scan limit for now — a temporary cap while we scale. Recent verdicts remain available.",
  token: "A fresh scan for this token is already running.",
  global: "Fresh-scan capacity is temporarily full — beta limits, they loosen as we scale. Try again shortly.",
  "pipeline-daily":
    "Today's fresh-scan capacity is full — a temporary cap while we scale. Existing receipts remain available.",
  "receipt-daily":
    "Today's receipt budget is full — a temporary cap while we scale. Existing receipts remain available.",
  background:
    "Background capacity is temporarily full — a conservative cap kept separate from user-facing scan capacity.",
};

/** Rebuild the public verdict object from its ledger row (cooldown DB serve). */
export function verdictFromRow(row: VerdictRow): Verdict {
  return {
    tokenAddress: row.token_address,
    tokenName: row.token_name,
    tokenSymbol: row.token_symbol,
    score: row.score,
    tier: row.tier,
    criticalOverride: row.critical_override,
    scoreVersion: row.score_version,
    checks: row.checks,
    market: row.market_snapshot,
  };
}

/** The ledger block the scan response exposes for a verdict row. */
export function ledgerFromRow(row: VerdictRow) {
  return {
    id: row.id,
    entryHash: row.entry_hash,
    prevHash: row.prev_hash,
    createdAt: row.created_at,
  };
}

/**
 * A scan response for our own token: the scan still runs and is recorded, but
 * score, tier, per-check points and the score history never leave the server.
 */
export function ownTokenScanBody<T extends { verdict: Verdict; ledger: unknown }>(body: T) {
  const { score: _score, tier: _tier, criticalOverride: _override, checks, ...rest } = body.verdict;
  return {
    ...body,
    verdict: {
      ...rest,
      notScored: OWN_TOKEN_NOT_SCORED,
      checks: checks.map(({ deduction: _d, weight: _w, ...c }) => c),
    },
    record: null,
  };
}
