import { PRIOR_HONEYPOT_CAP, PRIOR_MARK_CAP } from "../config/formula";
import type { CheckResult, TokenMark, TokenRecord } from "../types";
import {
  readTokenMarks as repoReadTokenMarks,
  readTokenMark as repoReadTokenMark,
  readTokenRecord as repoReadTokenRecord,
  recordPumpDumpMark as repoRecordPumpDumpMark,
  recordHoneypotMark as repoRecordHoneypotMark,
  liftMark as repoLiftMark,
} from "../data/marks";

/**
 * The Record (#1, §15.5) — persistent token marks that outlive live contract
 * state. A honeypot verdict or a confirmed pump-and-dump marks the token
 * forever; any active mark caps future scores at DANGER so a disabled trap or
 * a dumped token can never buy back a CLEAR. An admin can lift a mark for a
 * verified false positive; a lifted mark stays visible with its reason and
 * re-arms automatically if the behavior repeats.
 */

const MARK_KIND = "honeypot" as const;


/** Read every mark on a token, all kinds (for scoring and the Record). */
export async function readTokenMarks(
  tokenAddress: string
): Promise<TokenMark[]> {
  return repoReadTokenMarks(tokenAddress);
}

/** Read the active-or-lifted honeypot mark for a token (legacy single-kind read). */
export async function readTokenMark(
  tokenAddress: string
): Promise<TokenMark | null> {
  return repoReadTokenMark(tokenAddress, MARK_KIND);
}

/** Full record for a token page: verdict stamps + all marks. */
export async function readTokenRecord(
  tokenAddress: string,
  limit = 24
): Promise<TokenRecord> {
  return repoReadTokenRecord(tokenAddress, limit);
}

/**
 * The post-score rule as a check row (rendered in the evidence list). An active
 * mark is a FAIL; a lifted mark is a PASS carrying the pardon note; no mark is a
 * clean PASS. Weight is null — the DANGER cap, not a deduction, does the work.
 */
export function priorHoneypotCheck(mark: TokenMark | null): CheckResult {
  const base = {
    id: "prior_honeypot",
    name: "Prior honeypot mark",
    weight: null,
    deduction: 0,
    source: "RobinCalls DB" as const,
  };
  if (!mark) {
    return { ...base, status: "PASS", reason: "No prior honeypot on record.", evidence: {} };
  }
  const markedOn = new Date(mark.createdAt).toISOString().slice(0, 10);
  if (mark.liftedAt) {
    const liftedOn = new Date(mark.liftedAt).toISOString().slice(0, 10);
    return {
      ...base,
      status: "PASS",
      reason: `Prior honeypot mark lifted after manual review on ${liftedOn}: ${mark.liftedReason ?? "no reason given"}.`,
      evidence: { markedOn, liftedOn, liftedReason: mark.liftedReason, firedCount: mark.firedCount },
    };
  }
  return {
    ...base,
    status: "FAIL",
    reason: `Flagged as a honeypot on ${markedOn}. The Record never forgets: score capped at ${PRIOR_HONEYPOT_CAP} (DANGER).`,
    evidence: { markedOn, firedCount: mark.firedCount, sourceVerdictId: mark.sourceVerdictId },
  };
}

/**
 * The pump-and-dump post-score rule as a check row (§15.5). Same shape as the
 * honeypot rule: active mark = FAIL (the DANGER cap does the scoring work),
 * lifted mark = PASS with the public pardon note.
 */
export function priorPumpDumpCheck(mark: TokenMark | null): CheckResult {
  const base = {
    id: "prior_pump_dump",
    name: "Prior pump-and-dump mark",
    weight: null,
    deduction: 0,
    source: "RobinCalls DB" as const,
  };
  if (!mark) {
    return { ...base, status: "PASS", reason: "No pump-and-dump on record.", evidence: {} };
  }
  const markedOn = new Date(mark.createdAt).toISOString().slice(0, 10);
  if (mark.liftedAt) {
    const liftedOn = new Date(mark.liftedAt).toISOString().slice(0, 10);
    return {
      ...base,
      status: "PASS",
      reason: `Prior pump-and-dump mark lifted after manual review on ${liftedOn}: ${mark.liftedReason ?? "no reason given"}.`,
      evidence: { markedOn, liftedOn, liftedReason: mark.liftedReason, firedCount: mark.firedCount },
    };
  }
  return {
    ...base,
    status: "FAIL",
    reason: `Pumped and dumped on ${markedOn}: price collapsed from its peak after a wash-inflated run. The Record never forgets: score capped at ${PRIOR_MARK_CAP} (DANGER).`,
    evidence: { markedOn, firedCount: mark.firedCount, sourceVerdictId: mark.sourceVerdictId },
  };
}

/**
 * Record (or re-arm) a pump-and-dump mark from the Watch (§15.5). Uses the
 * kind-generic RPC from migration 0008; the DB serializes per (token, kind)
 * and audits every transition into mark_events.
 */
export async function recordPumpDumpMark(
  args: {
    tokenAddress: string;
    evidence: Record<string, unknown>;
    liquidityUsd: number | null;
  }
): Promise<"created" | "re-fired" | "re-armed" | null> {
  return repoRecordPumpDumpMark(args);
}

/**
 * Record (or re-arm) a honeypot mark after a scan fired the honeypot override.
 * - No mark yet → create it + log 'created'.
 * - Active mark → bump fired_count + log 're-fired'.
 * - Lifted mark → RE-ARM (clear the pardon) + log 're-armed'. A pardoned token
 *   that traps again loses the pardon automatically.
 */
export async function recordHoneypotMark(
  args: {
    tokenAddress: string;
    verdictId: number | null;
    evidence: Record<string, unknown>;
    liquidityUsd: number | null;
  }
): Promise<void> {
  await repoRecordHoneypotMark(args);
}

/** Admin pardon: lift a mark. Reason is mandatory and public. */
export async function liftMark(
  token: string,
  reason: string,
  actor: string
): Promise<void> {
  await repoLiftMark(token, reason, actor);
}
