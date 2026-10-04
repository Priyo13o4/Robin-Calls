import { NextRequest, NextResponse } from "next/server";

import { readFinalSnapshotRow } from "@/lib/data/sale-referrals";
import { referralsUnavailable, walletParam } from "@/lib/referrals/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/referrals/airdrop?wallet=0x…
 *
 * The wallet's own row from the FINAL snapshot: what it did, what it is owed,
 * and the plain-English sentence saying why. docs/prds/REFERRALS.md promises that
 * sentence as the answer when someone writes in to ask — without this route it
 * took a manual SQL query to give it.
 *
 * Reads only the final run on purpose. Rehearsals are drafts the operator is
 * still iterating on; serving one to the wallet it describes would publish
 * conclusions the gates never cleared.
 *
 * `snapshotFinal` comes from reading the header, never from an assumption. The
 * three absence/fault states are different answers: no final run yet, a final
 * run that does not include this wallet, and "we could not look" — which is a
 * 503, because a fault dressed as `found: false` would tell someone with a
 * claim on the pool that the snapshot exists and excludes them.
 *
 * Amounts are base units as strings, never floats. This is the number a person
 * checks their own payment against, and a rounded figure is how a manual send is
 * off by dust in a way nobody notices.
 *
 * Says nothing about whether the wallet has been PAID. That lives in the payment
 * ledger and is the operator's record, not a promise to publish.
 */
export async function GET(req: NextRequest) {
  const blocked = referralsUnavailable();
  if (blocked) return blocked;

  const wallet = walletParam(req.nextUrl.searchParams.get("wallet"));
  if (!wallet) {
    return NextResponse.json({ error: "Missing or invalid wallet address." }, { status: 400 });
  }

  const read = await readFinalSnapshotRow(wallet);
  if (read.kind === "unavailable") {
    return NextResponse.json({ error: "Could not read the snapshot right now." }, { status: 503 });
  }
  if (read.kind === "absent") {
    return NextResponse.json({ found: false, snapshotFinal: read.snapshotFinal });
  }

  const row = read.row;
  return NextResponse.json({
    found: true,
    wallet: row.walletAddress,
    contributedWei: row.contributedWei.toString(),
    referredByWallet: row.referredByWallet,
    referralStatus: row.referralStatus,
    saleAllocationTokens: row.saleAllocationTokens.toString(),
    buyerBonusEligible: row.buyerBonusEligible,
    buyerBonusTokens: row.buyerBonusTokens.toString(),
    referredCount: row.referredCount,
    referredWei: row.referredWei.toString(),
    referredAllocationTokens: row.referredAllocationTokens.toString(),
    referrerQualified: row.referrerQualified,
    referrerCommissionTokens: row.referrerCommissionTokens.toString(),
    referrerRebateWei: row.referrerRebateWei.toString(),
    reason: row.reason,
  });
}
