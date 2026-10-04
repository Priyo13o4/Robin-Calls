"use client";

import Link from "next/link";

import { LeaderboardTable } from "./LeaderboardTable";
import { useLeaderboard } from "@/lib/referrals/useLeaderboard";

/** Rows in the rail. The full board lives on /leaderboard. */
const SNAPSHOT_ROWS = 10;

/**
 * A top-ten slice of one board, beside the buy panel. Its whole job is to make
 * a code feel worth sharing, and a position worth taking, before anyone has one.
 *
 * Renders NOTHING until there is something to show. An empty top ten on a sale
 * that has just opened reads as "nobody is contributing", which is a claim
 * about the sale rather than about the hour it happens to be.
 */
export function BoardSnapshot({
  board,
  highlightWallet,
}: {
  board: "contributions" | "referrals";
  highlightWallet?: string | null;
}) {
  const { status, rows } = useLeaderboard(board, SNAPSHOT_ROWS, 60_000);

  if (status !== "ready" || rows.length === 0) return null;

  const title = board === "referrals" ? "TOP REFERRERS" : "TOP CONTRIBUTORS";

  return (
    <div className="noir-card min-w-0 rounded-3xl border-2 border-[#2a2a2a] bg-[#141414] p-4 sm:p-5">
      <p className="font-mono text-[12px] font-bold tracking-[0.22em] text-white">{title}</p>

      <div className="relative mt-3">
        <LeaderboardTable
          board={board}
          rows={rows}
          highlightWallet={highlightWallet}
          compact
          emptyMessage=""
        />
        {/* Only fade when there is something under the fade to hide. */}
        {rows.length >= 4 && <ProgressiveFade />}
      </div>

      <Link
        href={`/leaderboard?board=${board === "referrals" ? "referrals" : "contributions"}`}
        className="mt-3 block rounded-full border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2.5 text-center font-mono text-[10px] tracking-[0.18em] text-[#ccff00] transition-colors hover:border-[#ccff00] hover:bg-[#1a1f0a]"
      >
        SEE ALL
      </Link>
    </div>
  );
}

/**
 * A real progressive blur, not one gradient: four stacked layers, each blurring
 * harder and masked to start lower, so focus falls away down the list instead
 * of switching off at one line. The colour wash on top carries it into the
 * card, which is what makes the last row read as "there is more" rather than
 * as the end.
 */
function ProgressiveFade() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24">
      {[0, 1, 2, 3].map((i) => {
        const mask = `linear-gradient(180deg, transparent ${i * 25}%, #000 ${(i + 1) * 25}%)`;
        return (
          <div
            key={i}
            className="absolute inset-0"
            style={{
              backdropFilter: `blur(${(i + 1) * 1.5}px)`,
              WebkitBackdropFilter: `blur(${(i + 1) * 1.5}px)`,
              maskImage: mask,
              WebkitMaskImage: mask,
            }}
          />
        );
      })}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(20,20,20,0) 0%, rgba(20,20,20,0.72) 58%, #141414 100%)",
        }}
      />
    </div>
  );
}
