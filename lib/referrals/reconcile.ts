import { type Address } from "viem";

import {
  issuePendingReferralCodes,
  markClaimRefused,
  markClaimVerified,
  noteClaimAttempt,
  readCensusFrontier,
  readMirroredRaisedTotal,
  readPendingClaims,
  recordCensusEntry,
  refreshWalletTotals,
  settleFirstContributions,
} from "@/lib/data/sale-referrals";
import { readKnownCensusWallets } from "@/lib/data/sale-referrals";
import { saleReader, readCensusHead, readCensusSlice } from "@/lib/referrals/census";
import { transactionAbsent, verifyContributionClaim } from "@/lib/referrals/contribution";
import { makeReadMany } from "@/lib/sale/reads";
import { SALE_STATE, tokenSaleAbi } from "@/lib/sale/abi";

/**
 * The reconciler: the backstop half of the contribution mirror.
 *
 * The claim endpoint does the work the moment a browser hands it a hash, but
 * anything it left pending (an RPC blip, a node lagging the browser's
 * receipt, a write fault) still has to land. This pass re-runs the SAME
 * verification the endpoint ran, over the pending set. No cursor, no block
 * ranges, no give-up cap: an unanswered claim is retried forever.
 *
 * The census half covers what no claim can: a contributor who called
 * contribute() straight from an explorer submits no hash, yet they still
 * earn their code and their leaderboard row. The census path settles on the
 * presence of a binding, exactly as the claim path does (0091 rework).
 */
export interface ReconcileResult {
  /** Claims examined this pass. */
  claims: number;
  /** Claims that reached a definitive verdict. */
  verified: number;
  refused: number;
  /** Claims left pending — an RPC fault, or a node that has not seen the tx. */
  stillPending: number;
  /** Pending claims not reached this pass because the claims budget ran out. */
  claimsDeferred: number;
  /** Direct contributors found in the census who had no claim row. */
  censusAdded: number;
  /** Wallets whose mirrored totals were refreshed from the chain. */
  totalsRefreshed: number;
  /** Every head read faulted. Retry next pass, nothing is wrong with config. */
  censusHeadUnread: boolean;
  /** The resolved chain holds no contract at the sale address. A CONFIG error,
   *  almost always a missing `token_sale_chain_id` row, and it will never fix
   *  itself. */
  noContractAtSaleAddress: boolean;
}

/** Claims get at most this much of the job's 60s so the census pass always runs. */
const CLAIMS_BUDGET_MS = 25_000;
/** A real tx is on chain within seconds; six hours of "not found" from a healthy node is final. */
const EXPIRE_AFTER_MS = 6 * 60 * 60 * 1000;
const EXPIRE_MIN_ATTEMPTS = 10;

export async function reconcileContributions(args: {
  saleAddress: string;
  chainId: number;
}): Promise<ReconcileResult> {
  const client = saleReader(args.chainId);
  const sale = args.saleAddress.toLowerCase() as Address;

  const out: ReconcileResult = {
    claims: 0,
    verified: 0,
    refused: 0,
    stillPending: 0,
    claimsDeferred: 0,
    censusAdded: 0,
    totalsRefreshed: 0,
    censusHeadUnread: false,
    noContractAtSaleAddress: false,
  };

  // No sale configured: nothing to check. The job returns an empty result
  // rather than failing — an unconfigured sale is a valid local state.
  if (!sale) return out;

  // ---- claims ----
  const pending = await readPendingClaims();
  out.claims = pending.length;

  const claimsDeadline = Date.now() + CLAIMS_BUDGET_MS;
  for (const [i, claim] of pending.entries()) {
    if (Date.now() > claimsDeadline) {
      out.claimsDeferred = pending.length - i;
      break;
    }
    const { outcome, blockTimestamp } = await verifyContributionClaim({
      client,
      txHash: claim.txHash as `0x${string}`,
      saleAddress: sale,
      claimingWallet: claim.walletAddress,
    });

    if (outcome.kind === "unknown") {
      // Unknown stays pending. A node that has not seen the tx yet answers
      // here too — the browser's receipt outran ours — and it clears next pass.
      // Past the expiry, a healthy node's "no such transaction" is a chain
      // answer, not a failed read, and a bogus hash must not be retried forever.
      const expired =
        claim.attempts >= EXPIRE_MIN_ATTEMPTS && Date.now() - claim.createdAt.getTime() > EXPIRE_AFTER_MS;
      if (expired && (await transactionAbsent(client, claim.txHash as `0x${string}`))) {
        await markClaimRefused({
          txHash: claim.txHash,
          walletAddress: claim.walletAddress,
          reason: "No transaction with this hash exists on chain.",
        }).catch(() => {});
        out.refused++;
        continue;
      }
      await noteClaimAttempt(claim.txHash).catch(() => {});
      out.stillPending++;
      continue;
    }
    if (outcome.kind === "refused") {
      await markClaimRefused({
        txHash: claim.txHash,
        walletAddress: claim.walletAddress,
        reason: outcome.reason,
      }).catch(() => {});
      out.refused++;
      continue;
    }
    // Verified, but the receipt's block timestamp did not come back. The
    // mirror row's block_time is the CHAIN's clock and nothing else, and it
    // is NOT NULL — so this stays pending rather than substituting ours
    // (§8 #11: a literal where a measurement belongs).
    if (blockTimestamp === null) {
      await noteClaimAttempt(claim.txHash).catch(() => {});
      out.stillPending++;
      continue;
    }

    try {
      await markClaimVerified({
        txHash: claim.txHash,
        walletAddress: claim.walletAddress,
        logIndex: outcome.contribution.logIndex,
        amountWei: outcome.contribution.amountWei,
        totalRaisedWei: outcome.contribution.totalRaisedWei,
        blockNumber: outcome.contribution.blockNumber,
        blockTime: blockTimestamp,
      });
      out.verified++;
    } catch {
      // The write failed, not the verification. Pending stays.
      out.stillPending++;
    }
  }

  // ---- the census ----
  const head = await readCensusHead(client, sale);
  if (head.contributorCount === undefined && head.totalRaised === undefined && head.state === undefined) {
    // Every head read came back unread. A sale address with no contract on the
    // resolved chain is a CONFIG error that would otherwise no-op forever behind
    // a green cron; an RPC fault is a retry. getCode tells them apart.
    try {
      const code = await client.getCode({ address: sale });
      if (!code || code === "0x") out.noContractAtSaleAddress = true;
      else out.censusHeadUnread = true;
    } catch {
      out.censusHeadUnread = true;
    }
  }
  const count = head.contributorCount;
  const total = head.totalRaised;

  // An unread census head is not an empty census (§8 #9): the pass records
  // nothing and says so through returned counts of zero: the next pass
  // reads again. And a MISSING totalRaised means we cannot claim the mirror
  // is current, so the refresh below is skipped too rather than half-run.
  if (count !== undefined) {
    const frontier = await readCensusFrontier();
    const totalNumber = Number(count);

    if (totalNumber > frontier) {
      const headBlock = await currentHead(client);
      if (headBlock !== null) {
        // The census array is append-only in push order: indices frontier..count-1
        // are wallets whose first contribution we have not recorded. An
        // undefined slot in the slice is an unread entry, not an absent
        // contributor: the next pass reads it again.
        // Capped at 500 per pass to prevent RPC timeouts or memory spikes.
        const toRead = Math.min(totalNumber, frontier + 500);
        const entries = await readCensusSlice(client, sale, frontier, toRead - 1);
        for (const entry of entries) {
          if (entry.walletAddress === undefined || entry.contributedWei === undefined) continue;
          try {
            const added = await recordCensusEntry({
              walletAddress: entry.walletAddress,
              contributedWei: entry.contributedWei,
              censusIndex: entry.index,
              firstObservedBlock: headBlock,
              refunded: entry.refunded,
            });
            if (added) out.censusAdded++;
          } catch {
            // One bad write must not stop the rest of the census pass.
          }
        }
      }
    }

    // Re-read known wallets' totals when totalRaised moves:
    // top-ups change `contributed(w)` without touching the census count, and
    // a verified claim records only its OWN transaction, not the wallet's
    // new sum. The census is the authority on amounts.
    if (total !== undefined) {
      const mirroredTotal = await readMirroredRaisedTotal();
      if (total !== mirroredTotal) {
        out.totalsRefreshed = await refreshKnownTotals(client, sale);
      } else if (head.state === SALE_STATE.ABANDONED) {
        // `claimRefund()` sets `refunded[w]` and touches NEITHER `totalRaised`
        // nor `contributed[w]`, so the comparison above is blind to every
        // refund that will ever happen: on an abandoned sale it matches
        // forever and the flag would never leave the mirror's default. Narrowed
        // to the rows still unresolved, so the cost decays to zero as people
        // claim rather than re-reading a settled census every cycle.
        out.totalsRefreshed = await refreshKnownTotals(client, sale, { onlyUnrefunded: true });
      }
    }
  }

  if (out.verified > 0 || out.censusAdded > 0) {
    await settleFirstContributions();
    await issuePendingReferralCodes();
  }

  return out;
}

/** The chain head for `first_observed_block`. Null when unread. */
async function currentHead(client: ReturnType<typeof saleReader>): Promise<number | null> {
  try {
    return Number(await client.getBlockNumber());
  } catch {
    return null;
  }
}

/**
 * Re-read `contributed(w)` and `refunded(w)` for every wallet the mirror holds,
 * in chunks of 100 via multicall with batchSize: 0.
 * A faulted read for one wallet is skipped, never written as zero — a lagging
 * node returns 0n for a real contribution, and a zero here would erase someone's
 * entire position (§8 #3, both directions).
 */
async function refreshKnownTotals(
  client: ReturnType<typeof saleReader>,
  sale: Address,
  opts: { onlyUnrefunded?: boolean } = {},
): Promise<number> {
  const wallets = await readKnownCensusWallets(opts);
  if (wallets.length === 0) return 0;

  const runner = makeReadMany(client);
  const CHUNK_SIZE = 100;
  let refreshedCount = 0;

  for (let i = 0; i < wallets.length; i += CHUNK_SIZE) {
    const chunk = wallets.slice(i, i + CHUNK_SIZE);
    const calls = chunk.flatMap((w) => [
      {
        label: "contributed",
        address: sale,
        abi: tokenSaleAbi,
        functionName: "contributed",
        args: [w.walletAddress as Address] as readonly unknown[],
      },
      {
        label: "refunded",
        address: sale,
        abi: tokenSaleAbi,
        functionName: "refunded",
        args: [w.walletAddress as Address] as readonly unknown[],
      },
    ]);

    const results = await runner(calls);
    const amounts: { walletAddress: string; contributedWei: bigint; refunded?: boolean }[] = [];

    for (let j = 0; j < chunk.length; j++) {
      const contRes = results[j * 2];
      const refRes = results[j * 2 + 1];
      if (contRes && contRes.ok && typeof contRes.value === "bigint") {
        amounts.push({
          walletAddress: chunk[j].walletAddress,
          contributedWei: contRes.value,
          refunded: refRes && refRes.ok && typeof refRes.value === "boolean" ? refRes.value : undefined,
        });
      }
    }

    if (amounts.length > 0) {
      await refreshWalletTotals(amounts);
      refreshedCount += amounts.length;
    }
  }

  return refreshedCount;
}
