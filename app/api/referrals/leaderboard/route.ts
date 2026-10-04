import { NextRequest, NextResponse } from "next/server";

import { readLeaderboardCached } from "@/lib/data/sale-referrals";
import { referralsUnavailable } from "@/lib/referrals/http";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 100;

/**
 * GET /api/referrals/leaderboard?board=contributions|referrals&limit=50
 *
 * Two boards, one route. Both are summed from the contract's own census as of
 * the reconciler's last pass.
 *
 * Cached in memory and single-flighted, keyed on the latest update timestamps
 * of both sale_wallet_totals and sale_participants.
 *
 * mirrorUpdatedAt ships with the rows and reflects the census refresh timestamp.
 */
export async function GET(req: NextRequest) {
  const blocked = referralsUnavailable();
  if (blocked) return blocked;

  const board = req.nextUrl.searchParams.get("board") === "referrals" ? "referrals" : "contributions";
  const requested = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT) : 50;

  const { read, mirrorUpdatedAt } = await readLeaderboardCached(board, limit);

  // 503, never an empty board. A 200 with no entries is read as "nobody is on
  // this board yet", which is a claim about the sale rather than about us.
  if (read.kind !== "found") {
    return NextResponse.json({ error: "The leaderboard is temporarily unavailable." }, { status: 503 });
  }
  const entries = read.entries;

  return NextResponse.json({
    board,
    entries: entries.map((e, i) => ({
      rank: i + 1,
      wallet: e.walletAddress,
      nickname: e.nickname,
      emoji: e.emoji,
      socials: e.socials,
      amountWei: e.amountWei.toString(),
      count: e.count,
      refunded: e.refunded,
    })),
    /** Null on a fault or before the reconciler's first pass. */
    mirrorUpdatedAt,
  });
}
