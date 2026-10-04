import type { CheckResult, Verdict } from "../types";

/**
 * Scan-uncertainty log: every place a verdict was INDEFINITE — a check that
 * SKIPped, a custody read that returned UNKNOWN, a contract custodian we
 * couldn't classify (the possible-locker case), pool materiality that went
 * unmeasured — becomes a reviewable row in scan_uncertainties.
 *
 * Born from BULL (verdict #128): the largest LP holder was StoxesFun's
 * permanent locker, the scanner honestly said "we can't tell", and nothing
 * anywhere recorded that a human should go look. The admin review queue
 * (/admin/review) is that record — an unclassified contract custodian can be
 * verified once and promoted straight into trusted_lockers.
 *
 * Rows are AGGREGATED per (token, check, code, subject): a rescanned token
 * bumps times_seen/last_seen_at instead of flooding the queue, and a row an
 * admin already reviewed keeps counting without reopening.
 *
 * collectUncertainties is pure (verdict in, rows out) so the rules are unit-
 * testable; persistUncertainties is best-effort by design — an observability
 * write must never fail a completed scan.
 */

export interface UncertaintyRow {
  checkId: string;
  /** Stable slug, e.g. 'contract-custodian-unclassified'. */
  code: string;
  /** The address/pool the doubt is about; '' when it's the whole check. */
  subject: string;
  summary: string;
  detail?: Record<string, unknown>;
}

interface AssessedPoolRow {
  dexId?: string;
  pool?: string;
  /**
   * V4 has no per-pool contract — every V4 row's `pool` is the shared
   * PoolManager singleton, identical across every pool on the chain. `poolId`
   * (the PoolKey hash) is what actually identifies ONE pool; prefer it as the
   * review-queue subject or every V4 skip collapses onto one meaningless row.
   */
  poolId?: string;
  protocol?: string;
  custodyState?: string;
  status?: string;
  reason?: string;
  poolShareOfLiquidity?: number | null;
  /** A deliberate, explained, non-material skip — not doubt. Never logged. */
  notScoredForCost?: boolean;
}

function lpCustodyRows(check: CheckResult): UncertaintyRow[] {
  const rows: UncertaintyRow[] = [];
  const ev = check.evidence;

  // The possible-locker case: a contract holds the pool and isn't on the
  // trusted_lockers list. Subject is the CONTRACT (what a human verifies),
  // and the detail names the pool/venue it controls.
  const puller = ev.largestPuller as
    | { address?: string; kind?: string; pctOfPool?: number | null }
    | undefined;
  // A subject the custody check REJECTED as the venue's own plumbing is not a
  // locker candidate, and this row is the one that offers "Trust as Locker" —
  // logging it would route an admin toward exempting a position manager from
  // whale detection chain-wide. Checked here as well as at the source because
  // this reader takes `largestPuller` on trust and nothing else stops it.
  const rejectedSubject = ev.subjectIsVenueInfrastructure === true;
  if (!rejectedSubject && puller?.address && puller.kind === "CONTRACT") {
    rows.push({
      checkId: check.id,
      code: "contract-custodian-unclassified",
      subject: puller.address.toLowerCase(),
      summary: `A contract controls ${(((puller.pctOfPool ?? 0) as number) * 100).toFixed(1)}% of the headline pool and isn't on the trusted-locker list — verify whether it's a locker.`,
      detail: {
        pool: ev.pool ?? ev.pair ?? null,
        dexId: ev.dexId ?? null,
        protocol: ev.protocol ?? null,
        pctOfPool: puller.pctOfPool ?? null,
      },
    });
  }

  // Pools whose custody read came back UNKNOWN — coverage too thin, events
  // unreadable, or a position manager we couldn't see through. A pool skipped
  // purely for being outside the cost cap's top-N by liquidity is NOT doubt —
  // it's a deliberate, already-explained non-material skip — so it's excluded.
  const pools = (ev.poolsAssessed as AssessedPoolRow[] | undefined) ?? [];
  for (const p of pools) {
    if (p.custodyState !== "UNKNOWN" || !p.pool || p.notScoredForCost) continue;
    // V4's `pool` is the shared PoolManager singleton (same address for every
    // V4 pool on the chain) — using it as the subject would both collapse
    // every distinct pool's row into one and send a reviewer to look up
    // Uniswap's own infra contract instead of anything token-specific.
    // `poolId` is the real per-pool identifier; prefer it when present.
    const subject = (p.poolId ?? p.pool).toLowerCase();
    rows.push({
      checkId: check.id,
      code: "custody-unknown",
      subject,
      summary: p.reason ?? "Pool custody could not be attributed.",
      detail: {
        dexId: p.dexId ?? null,
        protocol: p.protocol ?? null,
        poolShareOfLiquidity: p.poolShareOfLiquidity ?? null,
        ...(p.poolId ? { poolManagerContract: p.pool } : {}),
      },
    });
  }

  // §15.10d — the market oracle names a deepest pool this scan could not read
  // on-chain (starved, or a DEX/quote-asset/fee-tier discovery missed). Whether
  // or not it softened a FAIL, a human should confirm the scanner isn't blind to
  // this token's main venue — the SUSHICAT/SWOGE discovery-gap tripwire.
  const disagree = ev.deepestPoolDisagreement as
    | { marketDeepest?: string; marketLiquidityUsd?: number | null; readVenuesShare?: number | null; action?: string }
    | undefined;
  if (disagree?.marketDeepest) {
    rows.push({
      checkId: check.id,
      code: "deepest-pool-market-disagreement",
      subject: disagree.marketDeepest.toLowerCase(),
      summary:
        disagree.action === "softened-to-warn"
          ? "The market's deepest pool couldn't be read on-chain, so a custody FAIL was softened to a caution — verify the scanner isn't missing this token's main venue."
          : "The market names a deepest pool this scan couldn't read on-chain — verify the scanner covers this token's DEX / quote asset / fee tier.",
      detail: {
        marketLiquidityUsd: disagree.marketLiquidityUsd ?? null,
        readVenuesShare: disagree.readVenuesShare ?? null,
        action: disagree.action ?? "logged",
      },
    });
  }

  // §15.10b — the pools' relative sizes couldn't be measured, so the headline
  // pool was picked blind. The verdict discloses it; this makes it reviewable.
  if (ev.materialityUnmeasured === true) {
    rows.push({
      checkId: check.id,
      code: "materiality-unmeasured",
      subject: "",
      summary:
        "The token's pools could not be size-ranked on this scan — the headline custody verdict may not describe the main market.",
      detail: { pools: pools.map((p) => p.pool).filter(Boolean) },
    });
  }

  return rows;
}

/** Derive every indefinite conclusion recorded in a verdict. Pure. */
export function collectUncertainties(verdict: Verdict): UncertaintyRow[] {
  const rows: UncertaintyRow[] = [];

  for (const check of verdict.checks) {
    // Any SKIP is by definition "we couldn't tell" — one row per check.
    if (check.status === "SKIP") {
      rows.push({
        checkId: check.id,
        code: "check-skipped",
        subject: "",
        summary: check.reason,
      });
    }

    if (check.id === "lp_custody") rows.push(...lpCustodyRows(check));

    // The registry-gap detector. A contract creator is a shared deployment
    // surface; if it holds a material share of its own token's pool and is not
    // a registered locker, it is the next launchpad nobody has audited — the
    // shape that published "Deployer wallet ... can pull it at will" about a
    // permanently-locked position. Every pad-launched token reports its own pad,
    // so the queue finds them from real traffic instead of a sweep.
    if (check.id === "lp_custody" && check.evidence.deployerKind === "CONTRACT") {
      const deployer = check.evidence.deployer as string | undefined;
      const pct = (check.evidence.deployerPct as number | undefined) ?? 0;
      if (deployer) {
        // Fires whether or not the creator holds LP. Requiring a stake made the
        // cheapest evasion invisible: deploy through a throwaway factory, keep
        // the LP on your own wallet, and the contract-creator stand-down that
        // silences deployer history / lineage / rug-lineage leaves no trace.
        rows.push({
          checkId: check.id,
          code: "contract-creator-holds-lp",
          subject: deployer,
          summary:
            pct > 0
              ? `The token's creator is a contract holding ${(pct * 100).toFixed(1)}% of the pool and is not a registered locker. If it is a launchpad, register it; if its LP is withdrawable, the current finding is correct.`
              : "This token was deployed by a contract, so the per-deployer history checks stood down. Confirm it is a real launchpad and not a factory used to shed a deployer's record.",
          detail: { deployerPct: pct, custodyState: check.evidence.custodyState },
        });
      }
    }

    // A faulted classification silently softens the custody finding — the
    // deployer rung drops FAIL→WARN and the Wanted board stops producing —
    // so an RPC blip must at least be visible.
    if (
      check.id === "lp_custody" &&
      check.evidence.deployerKind === null &&
      ((check.evidence.deployerPct as number | undefined) ?? 0) > 0
    ) {
      rows.push({
        checkId: check.id,
        code: "deployer-kind-unreadable",
        subject: (check.evidence.deployer as string | undefined) ?? "",
        summary:
          "The deployer holds a material share but its entity classification could not be read, so the finding was hedged rather than proven.",
      });
    }

    // A honeypot PASS decided by the V4 Quoter alone, whose direct transfer
    // probe then couldn't run: the token's own transfer layer stayed unproven.
    const probe = (check.evidence.transferProbe as { status?: string; detail?: string } | undefined)
      ?.status;
    if (check.id === "honeypot" && probe === "INCONCLUSIVE") {
      rows.push({
        checkId: check.id,
        code: "transfer-probe-inconclusive",
        subject: "",
        summary:
          "The V4 quote passed but the direct transfer probe couldn't run, so the token's own transfer layer was not exercised.",
      });
    }
  }

  // Dedupe on the upsert key: several pools can share one subject (every V4
  // pool lives in the singleton, so their rows share its contract address),
  // and Postgres rejects a batch that touches one conflict row twice.
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.checkId}|${r.code}|${r.subject}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Upsert the rows for one scan. On conflict (same token/check/code/subject)
 * the row's last_seen/scan pointers and times_seen advance; first_seen_at and
 * any review verdict are left untouched. times_seen races under concurrent
 * scans are tolerated — it's a review queue, not an accounting ledger.
 */
import { upsertScanUncertaintiesRecord } from "../data/observability";

export async function persistUncertainties(
  meta: { tokenAddress: string; scanId: string; verdictId: number | null },
  rows: UncertaintyRow[],
): Promise<void> {
  if (rows.length === 0) return;
  try {
    await upsertScanUncertaintiesRecord(meta, rows);
  } catch (err) {
    console.error("[RC_DB_WRITE_FAILED] scan_uncertainties upsert failed:", err, {
      token: meta.tokenAddress,
      scanId: meta.scanId,
    });
  }
}
