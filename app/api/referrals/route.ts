import { NextRequest, NextResponse } from "next/server";

import {
  readContributionClaimStates,
  readParticipant,
  readWalletTotals,
} from "@/lib/data/sale-referrals";
import { resolveSaleAddress } from "@/lib/sale/address";
import { referralsUnavailable, walletParam } from "@/lib/referrals/http";
import { readReferralConfig } from "@/lib/referrals/config";
import { qualifiesAsReferrer } from "@/lib/referrals/rules";

export const dynamic = "force-dynamic";

/**
 * GET /api/referrals?wallet=0x…
 *
 * Everything one wallet needs to know about itself: its code, the code it used,
 * what it has put in, who it has brought, and whether it is on track for either
 * pool.
 *
 * `qualifiesNow` is explicitly a LIVE reading, not a promise. Eligibility is
 * settled at the close and nowhere else, so the field is named for the moment
 * it describes — a referrer at 0.11 ETH today can be below the bar tomorrow if
 * the operator moves the dial, and a UI that read this as "you have qualified"
 * would be publishing a guarantee we never made.
 *
 * The contribution answer is THREE states, and they are different sentences
 * on the panel:
 *
 *   confirmed   the census has the wallet — the contract itself counts it
 *   confirming  a claim exists and is pending; the chain receipt is in, our
 *               verification is not (or has not run yet)
 *   none        no census row and no pending claim
 *
 * `contributedWei` is 0 in the last two, and the panel must not render that 0
 * as "you have contributed nothing" while a claim is confirming — that is the
 * old bug where `canBind: true` invited a binding the chain had already
 * frozen.
 *
 * `mirrorUpdatedAt` travels with the numbers because they are only as current
 * as the reconciler's last pass (§9).
 */
export async function GET(req: NextRequest) {
  const blocked = referralsUnavailable();
  if (blocked) return blocked;

  const wallet = walletParam(req.nextUrl.searchParams.get("wallet"));
  if (!wallet) {
    return NextResponse.json({ error: "Missing or invalid wallet address." }, { status: 400 });
  }

  const [read, totals, config, claims] = await Promise.all([
    readParticipant(wallet),
    readWalletTotals(wallet),
    readReferralConfig(),
    readContributionClaimStates(wallet),
  ]);

  if (read.kind === "unavailable" || totals === null || claims === null) {
    return NextResponse.json({ error: "Could not read your referral status." }, { status: 503 });
  }

  const participant = read.kind === "found" ? read.participant : null;
  const confirmed = totals.contributedWei > 0n;

  return NextResponse.json({
    wallet,
    nickname: participant?.nickname ?? null,
    emoji: participant?.emoji ?? null,
    socials: participant?.socials ?? [],
    /** Null until this wallet's contribution is confirmed by the contract's census. */
    myCode: participant?.referralCode ?? null,
    usedCode: participant?.referredByCode ?? null,
    /** none | pending | credited | missed — see lib/data/sale-referrals.ts. */
    referralStatus: participant?.referralStatus ?? "none",
    /** False once a contribution is on chain: the binding is frozen from then on.
     *  The CHAIN's answer (contributedOnChain in the client) still outranks this
     *  for the same reason it always did — our mirror can lag a contribution the
     *  contract already counts. */
    canBind: participant?.firstContributionBlock == null && !confirmed,
    /** confirmed | confirming | none. The panel renders its third state from
     *  this, never from a wei comparison. */
    contributionState: claims.contributionState,
    contributedWei: totals.contributedWei.toString(),
    referredCount: totals.referredCount,
    referredWei: totals.referredWei.toString(),
    qualifiesNow: qualifiesAsReferrer(
      { wallet, referredCount: totals.referredCount, referredWei: totals.referredWei },
      config.rules,
    ),
    rules: {
      minReferredWallets: config.rules.minReferredWallets,
      minReferredWei: config.rules.minReferredWei.toString(),
    },
    /** Null when the mirror has never run or its own state could not be read. */
    mirrorUpdatedAt: claims.mirrorUpdatedAt,
  });
}
