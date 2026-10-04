import { NextRequest, NextResponse } from "next/server";

import { resolveSaleAddress } from "@/lib/sale/address";
import { referralsUnavailable, walletParam } from "@/lib/referrals/http";
import { saleReader } from "@/lib/referrals/census";
import { verifyContributionClaim } from "@/lib/referrals/contribution";
import { blockTimestamps } from "@/lib/rpc/block-time";
import {
  issuePendingReferralCodes,
  markClaimRefused,
  markClaimVerified,
  noteClaimAttempt,
  recordContributionClaim,
  settleFirstContributions,
} from "@/lib/data/sale-referrals";
import { reportError } from "@/lib/observability/reporter";

export const dynamic = "force-dynamic";

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * POST /api/referrals/contribute   { wallet, txHash }
 *
 * The fast path of the contribution mirror. The browser has just awaited the
 * receipt itself — it already holds the hash — and posts it here. This route
 * verifies INDEPENDENTLY: the browser supplies a pointer, never a claim.
 *
 *   1. record the claim row FIRST, before any RPC, and answer — an RPC
 *      outage can cost the user a delay, never their place in the queue
 *   2. receipt exists → mined; status success → not reverted
 *   3. a Contributed log from the sale address
 *   4. the log's contributor matches the claiming wallet (the event, never
 *      tx.from — §8 #19)
 *
 * On verification: write the contribution, settle eligibility, issue the
 * wallet's referral code. The reconciler job is the backstop that re-runs
 * this same check for anything left pending.
 *
 * Deliberately unauthenticated beyond the rate limit, like the rest of the
 * referral surface: a claim is only ever READ against the chain, and a
 * signature would add nothing the receipt does not already prove. The wallet
 * parameter is cross-checked against the log in step 4, so posting a hash
 * under someone else's wallet is refused and posting someone else's hash
 * under your own wallet is refused.
 */
export async function POST(req: NextRequest) {
  const blocked = referralsUnavailable();
  if (blocked) return blocked;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const wallet = walletParam(body.wallet);
  if (!wallet) {
    return NextResponse.json({ error: "Missing or invalid wallet address." }, { status: 400 });
  }

  const txHash = typeof body.txHash === "string" ? body.txHash.trim().toLowerCase() : "";
  if (!TX_HASH.test(txHash)) {
    return NextResponse.json({ error: "Missing or invalid transaction hash." }, { status: 400 });
  }

  const sale = await resolveSaleAddress();
  if (sale.kind !== "address") {
    return NextResponse.json(
      { error: sale.kind === "unconfigured" ? "The sale is not configured." : "We could not read the sale address. Please try again." },
      { status: sale.kind === "unconfigured" ? 400 : 503 },
    );
  }

  // Step 1: the row exists from here on, no matter what the chain does next.
  let claim;
  try {
    claim = await recordContributionClaim(txHash, wallet);
  } catch {
    // The user is waiting and this write is the thing they are waiting on.
    return NextResponse.json(
      { error: "We could not record your contribution just now. Please try again." },
      { status: 503 },
    );
  }
  if (claim.kind === "claimed-by-other") {
    return NextResponse.json(
      { error: "That transaction was already submitted by a different wallet." },
      { status: 409 },
    );
  }
  if (claim.verdict !== "pending") {
    // Idempotent resubmission of a decided claim: the answer is the verdict.
    return NextResponse.json({ ok: true, verdict: claim.verdict, alreadyDecided: true });
  }

  // Step 2–4: verify against the chain. Everything after this point is
  // retry-shaped: an `unknown` leaves the claim pending, and the response
  // says so rather than pretending the contribution is recorded.
  const { outcome, blockTimestamp } = await verifyContributionClaim({
    client: saleReader(sale.chainId),
    txHash: txHash as `0x${string}`,
    saleAddress: sale.address,
    claimingWallet: wallet,
  });

  if (outcome.kind === "unknown") {
    await noteClaimAttempt(txHash).catch(() => {});
    return NextResponse.json({
      ok: true,
      verdict: "pending",
      detail: "We have your transaction and will confirm it from the chain shortly.",
    });
  }

  if (outcome.kind === "refused") {
    try {
      await markClaimRefused({ txHash, walletAddress: wallet, reason: outcome.reason });
    } catch {
      // The refusal is a chain fact and will be re-derived by the reconciler
      // on the next pass over the pending claim; nothing is lost by this
      // write failing, so it must not mask the answer with a 500.
    }
    return NextResponse.json({ ok: false, verdict: "refused", error: outcome.reason }, { status: 409 });
  }

  // Verified: write the contribution, settle eligibility, issue the code.
  // `block_time` is NOT NULL and must be the CHAIN's clock, never ours
  // (§8 #11: a substituted measurement is a guess with a timestamp on it).
  // When the receipt's block read faulted, re-ask through the block-time
  // cache; if even that fails, the claim stays pending and the reconciler
  // retries the whole write rather than freezing our clock into the row
  // eligibility is compared against.
  let blockTime = blockTimestamp;
  if (blockTime === null) {
    const client = saleReader(sale.chainId);
    const times = await blockTimestamps([outcome.contribution.blockNumber], {
      client,
      chainId: sale.chainId,
    });
    blockTime = times.get(outcome.contribution.blockNumber) ?? null;
  }
  if (blockTime === null) {
    return NextResponse.json({
      ok: true,
      verdict: "pending",
      detail: "Your contribution is confirmed on chain. Recording it is taking a moment.",
    });
  }

  try {
    await markClaimVerified({
      txHash,
      walletAddress: wallet,
      logIndex: outcome.contribution.logIndex,
      amountWei: outcome.contribution.amountWei,
      totalRaisedWei: outcome.contribution.totalRaisedWei,
      blockNumber: outcome.contribution.blockNumber,
      blockTime,
    });
    await settleFirstContributions();
    await issuePendingReferralCodes();
  } catch (error) {
    await reportError({
      code: "RC_CONTRIBUTION_CLAIM_WRITE_FAILED",
      message: "contribution claim verified but the mirror write failed",
      operation: "referrals.contribute",
      error,
    });
    // The claim stays pending and the reconciler retries the whole write.
    return NextResponse.json({
      ok: true,
      verdict: "pending",
      detail: "Your contribution is confirmed on chain. Recording it is taking a moment.",
    });
  }

  return NextResponse.json({ ok: true, verdict: "verified" });
}
