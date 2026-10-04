import { createHash } from "crypto";
import { reportError } from "../observability/reporter";
import { getLatestGlobalVerdictHash, insertVerdict, incrementVerdictsIssued } from "../data/ledger";
import type { Verdict } from "../types";
import type { CanonicalVerdictRow } from "../data/ledger";

export const GENESIS_HASH = "genesis";

/**
 * Canonical, deterministic serialization of a verdict for hashing (§7.4).
 * Key order is fixed; anyone can re-derive entry_hash from the public row.
 */
export function canonicalPayload(v: Verdict, createdAtIso: string): string {
  return JSON.stringify({
    token_address: v.tokenAddress.toLowerCase(),
    score: v.score,
    tier: v.tier,
    critical_override: v.criticalOverride,
    score_version: v.scoreVersion,
    checks: v.checks.map((c) => ({
      id: c.id,
      status: c.status,
      deduction: c.deduction,
    })),
    created_at: createdAtIso,
  });
}

export function chainHash(prevHash: string, payload: string): string {
  return createHash("sha256").update(`${prevHash}:${payload}`).digest("hex");
}

/** Receipt metadata added by migration 0007 (PRD §16.1). */
export interface ReceiptExtras {
  resultFingerprint: string;
  receiptPolicyVersion: string;
  completeness: "complete" | "partial";
  dexProtocols: string[];
  primaryPoolAddress: string | null;
  scanStartedAt: string;
}

const MAX_APPEND_ATTEMPTS = 3;

/**
 * Append a verdict to the hash chain: read the head, link, insert.
 *
 * Two racing appends reading the same head would fork the chain; the 0007
 * unique index on prev_hash turns the loser's insert into a 23505 conflict,
 * which we resolve by re-reading the head and retrying (bounded, §16.5).
 */
export async function appendToLedger(
  verdict: Verdict,
  extras?: ReceiptExtras
): Promise<CanonicalVerdictRow | null> {
  for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt++) {
    const headHash = await getLatestGlobalVerdictHash();
    const prevHash = headHash ?? GENESIS_HASH;
    const createdAt = new Date().toISOString();
    const entryHash = chainHash(prevHash, canonicalPayload(verdict, createdAt));

    try {
      const inserted = await insertVerdict({
        tokenAddress: verdict.tokenAddress.toLowerCase(),
        tokenName: verdict.tokenName,
        tokenSymbol: verdict.tokenSymbol,
        score: verdict.score,
        tier: verdict.tier,
        criticalOverride: verdict.criticalOverride,
        scoreVersion: verdict.scoreVersion,
        checks: verdict.checks,
        marketSnapshot: verdict.market,
        entryHash,
        prevHash,
        createdAt,
        resultFingerprint: extras?.resultFingerprint,
        receiptPolicyVersion: extras?.receiptPolicyVersion,
        completeness: extras?.completeness,
        // `[]`, not `[""]`: the SQL default is '{}' and every other call site
        // uses `?? []`. Writing a one-element array containing an empty string
        // put a phantom protocol into a permanent, hash-chained public receipt
        // and made `dex_protocols.length` non-zero for scans with no DEX
        // coverage at all.
        dexProtocols: extras?.dexProtocols ?? [],
        primaryPoolAddress: extras?.primaryPoolAddress,
        scanStartedAt: extras?.scanStartedAt,
      });

      if (inserted) {
        return inserted;
      }
    } catch (err: any) {
      const code = err?.code || err?.cause?.code;
      if (code === "23505" && attempt < MAX_APPEND_ATTEMPTS) {
        continue;
      }
      await reportError({
        code: code === "23505" ? "RC_LEDGER_FORK_RETRY_EXHAUSTED" : "RC_LEDGER_APPEND_FAILED",
        message: `ledger append failed after ${attempt} attempt(s): ${err.message || String(err)}`,
        operation: "hashchain.append",
        tokenAddress: verdict.tokenAddress,
        details: { pgCode: code, attempts: attempt },
      });
      return null;
    }
  }
  return null;
}


/**
 * Increment the public "verdicts_issued" counter (§16.5). Best-effort: the true
 * count is always recomputable from the verdicts table, so a failure here is
 * logged, never thrown.
 */
export async function bumpVerdictsIssued(
  updatedAtIsoParam?: string
): Promise<void> {
  const updatedAtIso = updatedAtIsoParam ?? new Date().toISOString();

  try {
    await incrementVerdictsIssued(updatedAtIso);
  } catch {
    /* best-effort */
  }
}
